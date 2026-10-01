/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import { columnFor, isDone, readStatus } from "./columns";
import type { Ask, BoardRow, Failure, LabSnapshot, Seat, Workstream } from "./reads";

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
 * 1. a seat whose id is the assignee;
 * 2. the one seat whose own name is the assignee;
 * 3. when that name belongs to seats in more than one team, the one of them
 *    that is a member of the row's channel.
 *
 * Still more than one, or none, is no seat: a row is never shown against
 * several seats, or against a guess. Which seat actually claimed the row is
 * not published to a browser, and a declared assignee-to-seat map is
 * FIX-1672's.
 */
export function seatFor(roster: Roster, row: BoardRow): Seat | undefined {
  if (row.assignee === null) return undefined;
  const exact = roster.seats.find((seat) => seat.id === row.assignee);
  if (exact !== undefined) return exact;
  const named = roster.seats.filter((seat) => seat.name === row.assignee);
  if (named.length <= 1) return named[0];
  const members = new Set(roster.workstreams.find((w) => w.id === row.channelId)?.members ?? []);
  const inChannel = named.filter((seat) => members.has(seat.id));
  return inChannel.length === 1 ? inChannel[0] : undefined;
}

/** A worker's status (BR-8). */
export type WorkerStatus = "working" | "waiting on you" | "idle";

/** *working* with a running row, *waiting on you* with a parked one, *idle* otherwise. */
export function workerStatus(seat: Seat, rows: readonly BoardRow[], roster: Roster): WorkerStatus {
  const held = rows.filter((row) => seatFor(roster, row)?.id === seat.id);
  if (held.some((row) => readStatus(row.status) === "in_progress")) return "working";
  if (held.some((row) => readStatus(row.status) === "parked")) return "waiting on you";
  return "idle";
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

/** The teams in the seat inventory, each with its seats, in first-seen order. */
export function teamsOf(seats: readonly Seat[]): Array<{ team: string; seats: Seat[] }> {
  const teams = new Map<string, Seat[]>();
  for (const seat of seats) teams.set(seat.team, [...(teams.get(seat.team) ?? []), seat]);
  return [...teams].map(([team, members]) => ({ team, seats: members }));
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
