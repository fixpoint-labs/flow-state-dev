/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import { columnFor, isDone, readStatus } from "./columns";
import { STAFF_TEAM, type Ask, type BoardRow, type Failure, type LabSnapshot, type Seat, type Workstream } from "./reads";

/** A loaded snapshot (not a refusal, not an unreachable Lab). */
export type LoadedSnapshot = Exclude<LabSnapshot, { refused: Failure } | { unreachable: Failure }>;

/** Every row on every attached board that loaded, across workstreams. */
export function allRows(snapshot: LoadedSnapshot): BoardRow[] {
  return Object.values(snapshot.boards).flatMap((boards) => (boards.ok ? boards.value.rows : []));
}

/** The rows Tasks shows: every attached board's, excluding done ones (BR-15). */
export function openRows(snapshot: LoadedSnapshot): BoardRow[] {
  return allRows(snapshot).filter((row) => !isDone(row.status));
}

/** The seats and workstreams a row's assignee is resolved against. */
export type Roster = { seats: readonly Seat[]; workstreams: readonly Workstream[] };

/**
 * The seat a row is held by, or `undefined` when no single seat is.
 *
 * A row names an `assignee`, which is a routing key a board's workers answer
 * to, not a seat address: a board may name `<name>` for the seat
 * `<team>.<name>`. So, in order:
 *
 * 1. a seat whose id, or whose logical seat id (a hired seat's `<seatId>`
 *    inside its `<org>.<seatId>` address), is the assignee;
 * 2. the one seat whose own name is the assignee;
 * 3. when that name belongs to seats in more than one team, the one of them
 *    that is a member of the row's channel, by either id.
 *
 * Still more than one, or none, is no seat: a row is never shown against
 * several seats, or against a guess. Which seat actually claimed the row is
 * not published to a browser, and a declared assignee-to-seat map is
 * FIX-1672's.
 */
export function seatFor(roster: Roster, row: BoardRow): Seat | undefined {
  if (row.assignee === null) return undefined;
  const exact = roster.seats.find((seat) => seat.id === row.assignee || seat.seatId === row.assignee);
  if (exact !== undefined) return exact;
  const named = roster.seats.filter((seat) => seat.name === row.assignee);
  if (named.length <= 1) return named[0];
  const members = new Set(roster.workstreams.find((w) => w.id === row.channelId)?.members ?? []);
  const inChannel = named.filter((seat) => members.has(seat.id) || members.has(seat.seatId));
  return inChannel.length === 1 ? inChannel[0] : undefined;
}

/** A worker's shift status, the one word Roster, the sidebar and the workstream panel draw. */
export type ShiftStatus = "on shift" | "on call" | "off shift";

/** The three statuses, in the order Roster groups them. */
export const SHIFT_STATUSES: readonly ShiftStatus[] = ["on shift", "on call", "off shift"];

/** One seat's state: its status, the tasks it holds, and the asks it waits on you with. */
export type SeatState = {
  seat: Seat;
  status: ShiftStatus;
  /** Its rows that are running or waiting on you, in board order: its slots in use. */
  held: BoardRow[];
  /** Its pending asks, in Inbox's order. */
  asks: Ask[];
};

/** Every seat's state, and whether the result is partial. */
export type SeatStates = {
  /** Keyed by seat id, in inventory order. */
  seats: Map<string, SeatState>;
  /** Asks did not load: a seat waiting on you only through an ask reads off shift. */
  partial: boolean;
};

const computed = new WeakMap<LoadedSnapshot, SeatStates>();

/**
 * Every seat's status, worked out once per snapshot from what the Lab records:
 * its rows (each resolved by {@link seatFor}) and its pending asks.
 *
 * - **on shift**: it holds a running row;
 * - **on call**: otherwise, it holds a row waiting on you (the legacy
 *   `awaiting_review` included) or has a pending ask;
 * - **off shift**: neither. Queued, blocked, errored and finished rows hold no
 *   slot.
 *
 * A row no single seat resolves to, and an ask whose session names no seat in
 * the inventory, count for nobody. Asks that did not load leave every status
 * as the boards give it and mark the result `partial`.
 *
 * Every screen that draws a status or a count reads this result, and the same
 * snapshot always gets the same object.
 */
export function seatStates(snapshot: LoadedSnapshot): SeatStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const roster = rosterOf(snapshot);
  const seats = new Map<string, SeatState>(
    roster.seats.map((seat) => [seat.id, { seat, status: "off shift", held: [], asks: [] }]),
  );
  for (const row of allRows(snapshot)) {
    const status = readStatus(row.status);
    if (status !== "in_progress" && status !== "parked") continue;
    const owner = seatFor(roster, row);
    if (owner !== undefined) seats.get(owner.id)?.held.push(row);
  }
  for (const ask of snapshot.asks.ok ? snapshot.asks.value : []) {
    if (ask.seatId !== null) seats.get(ask.seatId)?.asks.push(ask);
  }
  for (const state of seats.values()) {
    state.status = state.held.some((row) => readStatus(row.status) === "in_progress")
      ? "on shift"
      : state.held.length > 0 || state.asks.length > 0
        ? "on call"
        : "off shift";
  }
  const result = { seats, partial: !snapshot.asks.ok };
  computed.set(snapshot, result);
  return result;
}

/** The seats and workstreams of a snapshot whose inventory loaded; empty otherwise. */
export function rosterOf(snapshot: LoadedSnapshot): Roster {
  return snapshot.inventory.ok ? snapshot.inventory.value : { seats: [], workstreams: [] };
}

/**
 * The asks a workstream's Stream shows (BR-18): the Inbox's asks whose seat is
 * one of the channel's members, in Inbox's order.
 */
export function asksFor(workstream: Workstream, asks: readonly Ask[]): Ask[] {
  const members = new Set(workstream.members);
  return asks.filter((ask) => ask.seatId !== null && members.has(ask.seatId));
}

/**
 * The workstreams an ask belongs to: the channel whose post started the run,
 * when there is one, otherwise every channel the seat is a member of.
 */
export function workstreamsOf(ask: Ask, workstreams: readonly Workstream[]): Workstream[] {
  const parent = workstreams.find((w) => w.id === ask.parentSessionId);
  if (parent !== undefined) return [parent];
  return ask.seatId === null ? [] : workstreams.filter((w) => w.members.includes(ask.seatId!));
}

/**
 * The door of the flow that owns a session: the seat inventory row whose id is
 * that flow's id names it. `null` when no seat row matches or its kind takes
 * no message.
 */
export function doorOf(seats: readonly Seat[], flowId: string): string | null {
  return seats.find((seat) => seat.id === flowId)?.door ?? null;
}

/**
 * The rows a `@worker` line can go to (BR-19): the seat's rows on this
 * workstream's boards that are running, parked, or pending with a run linked.
 */
export function messageableRows(roster: Roster, rows: readonly BoardRow[], seat: Seat): BoardRow[] {
  return rows.filter((row) => {
    if (seatFor(roster, row)?.id !== seat.id) return false;
    const status = readStatus(row.status);
    return status === "in_progress" || status === "parked" || (status === "pending" && row.run !== null);
  });
}

/**
 * The member a `@name` line addresses: a member of the workstream whose seat
 * id, or whose own name, is `name`. `undefined` when none, or more than one.
 */
export function addressedSeat(roster: Roster, workstream: Workstream, name: string): Seat | undefined {
  const members = new Set(workstream.members);
  const found = roster.seats.filter((seat) => members.has(seat.id) && (seat.id === name || seat.name === name));
  return found.length === 1 ? found[0] : undefined;
}

/** Rows grouped by column, in column order. */
export function byColumn(rows: readonly BoardRow[]): Map<ReturnType<typeof columnFor>, BoardRow[]> {
  const grouped = new Map<ReturnType<typeof columnFor>, BoardRow[]>();
  for (const row of rows) {
    const column = columnFor(row.status);
    grouped.set(column, [...(grouped.get(column) ?? []), row]);
  }
  return grouped;
}

/**
 * The teams in the seat inventory, each with its seats, in first-seen order,
 * with the org seats' Staff group first.
 */
export function teamsOf(seats: readonly Seat[]): Array<{ team: string; seats: Seat[] }> {
  const teams = new Map<string, Seat[]>();
  for (const seat of seats) teams.set(seat.team, [...(teams.get(seat.team) ?? []), seat]);
  const all = [...teams].map(([team, members]) => ({ team, seats: members }));
  return [...all.filter((t) => t.team === STAFF_TEAM), ...all.filter((t) => t.team !== STAFF_TEAM)];
}

/** How many seats are in each status, and how many waits-on entries they have. */
export type ShiftCounts = Record<ShiftStatus, number> & {
  /** Each held task waiting on you plus each pending ask, across the seats counted. */
  waiting: number;
};

/** The counts over every seat in `states`, or over one team's. */
export function shiftCounts(states: SeatStates, team?: string): ShiftCounts {
  const counts: ShiftCounts = { "on shift": 0, "on call": 0, "off shift": 0, waiting: 0 };
  for (const { seat, status, held, asks } of states.seats.values()) {
    if (team !== undefined && seat.team !== team) continue;
    counts[status] += 1;
    counts.waiting += held.filter((row) => readStatus(row.status) === "parked").length + asks.length;
  }
  return counts;
}

/** The team a Roster address picks, or `null` (All) when the inventory has no such team. */
export function pickedTeam(seats: readonly Seat[], team: string | null): string | null {
  return team !== null && seats.some((seat) => seat.team === team) ? team : null;
}

/** How long ago `since` was, in a short human form. */
export function waited(since: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
