/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import { isDone, readStatus } from "./columns";
import {
  STAFF_TEAM,
  type Ask,
  type BoardRow,
  type Failure,
  type LabSnapshot,
  type Project,
  type Section,
  type Seat,
  workerOf,
  workstreamOf,
} from "./reads";

/** A loaded snapshot (not a refusal, not an unreachable Lab). */
export type LoadedSnapshot = Exclude<LabSnapshot, { refused: Failure } | { unreachable: Failure }>;

/** Every row on every board that loaded, across conversations. */
export function allRows(snapshot: LoadedSnapshot): BoardRow[] {
  return Object.values(snapshot.boards).flatMap((boards) => (boards.ok ? boards.value.rows : []));
}

/**
 * What a row's board is called on a screen: the workstream the conversation
 * that holds it leads (its `workstreamId`), so one worker's two workstreams
 * are two boards (BR-40); else the worker the conversation is with
 * (`@<worker>`); else the conversation's id.
 */
export function holderOf(snapshot: LoadedSnapshot, row: BoardRow): string {
  const session = snapshot.sessions.find((s) => s.id === row.holderSessionId);
  if (session === undefined) return row.holderSessionId;
  const workstream = workstreamOf(session);
  if (workstream !== null) return workstream;
  const worker = workerOf(session);
  return worker === null ? row.holderSessionId : `@${worker}`;
}

/** The rows Tasks shows: every attached board's, excluding done ones (BR-15). */
export function openRows(snapshot: LoadedSnapshot): BoardRow[] {
  return allRows(snapshot).filter((row) => !isDone(row.status));
}

/** The seats a row's assignee is resolved against. */
export type Roster = { seats: readonly Seat[] };

/**
 * The seat a row is held by, or `undefined` when no single seat is.
 *
 * A row names an `assignee`, which is a routing key a board's workers answer
 * to, not a seat address: a board may name `<name>` for the seat
 * `<team>.<name>`. So, in order:
 *
 * 1. the seat whose id is the assignee;
 * 2. the one seat whose own name is the assignee.
 *
 * A name more than one seat carries, or none, is no seat: a row is never shown against
 * several seats, or against a guess. Which seat actually claimed the row is
 * not published to a browser, and a declared assignee-to-seat map is
 * FIX-1672's.
 */
export function seatFor(roster: Roster, row: BoardRow): Seat | undefined {
  if (row.assignee === null) return undefined;
  const exact = roster.seats.find((seat) => seat.id === row.assignee);
  if (exact !== undefined) return exact;
  const named = roster.seats.filter((seat) => seat.name === row.assignee);
  return named.length === 1 ? named[0] : undefined;
}

/** A worker's shift status, the one word Roster and the sidebar draw. */
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

/** The seats of a snapshot whose inventory loaded; empty otherwise. */
export function rosterOf(snapshot: LoadedSnapshot): Roster {
  return snapshot.inventory.ok ? snapshot.inventory.value : { seats: [] };
}

/**
 * The pending asks a task's run waits on (BR-17): those in the session its
 * row's run link names, stamped with this task, or unstamped and raised by
 * the very request the link names. Empty while the snapshot or its asks
 * aren't read.
 */
export function asksOfTask(snapshot: LabSnapshot | undefined, row: BoardRow | undefined): Ask[] {
  if (snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined || !snapshot.asks.ok || row?.run == null) return [];
  const { sessionId, requestId } = row.run;
  return snapshot.asks.value.filter(
    (ask) =>
      ask.sessionId === sessionId && (ask.item.taskId === row.id || (ask.item.taskId === undefined && ask.item.requestId === requestId)),
  );
}

/**
 * The door of the flow that owns a session: the seat inventory rows of the
 * workers on that flow name it, since a worker flow is registered at its kind.
 * Every worker on one flow shares its door. `null` when no seat row is on the
 * flow, or its kind takes no message.
 */
export function doorOf(seats: readonly Seat[], flowId: string): string | null {
  return seats.find((seat) => seat.kind === flowId)?.door ?? null;
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

/** PROJECTS: every project the person reads. */
export type ProjectsView = { projects: Project[] };

/**
 * PROJECTS (BR-22): every project the person reads, shared ones and their own
 * private ones. Derived from the snapshot alone: no read of its own. Fails when
 * the projects read did.
 */
export function projectsOf(snapshot: LoadedSnapshot): Section<ProjectsView> {
  if (!snapshot.projects.ok) return snapshot.projects;
  return { ok: true, value: { projects: snapshot.projects.value.rows } };
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

/**
 * The name a seat must carry to be the chief of staff: an org seat's id, or a
 * team seat's name. The only place Shift Manager names a seat (D2).
 */
const CHIEF_OF_STAFF = "chief-of-staff";

/** Which seat Shift Manager talks to as the chief of staff, if exactly one is. */
export type ChiefOfStaff = { kind: "one"; seat: Seat } | { kind: "none" } | { kind: "several"; seats: Seat[] };

/**
 * The chief of staff among the inventory's seats (D2): the seats whose name is
 * exactly `chief-of-staff`. That is an org seat (`chief-of-staff`) or a
 * team's worker (`<team>.chief-of-staff`). One is the chief of staff; two or
 * more are a state, never a guess.
 */
export function chiefOfStaffOf(seats: readonly Seat[]): ChiefOfStaff {
  const found = seats.filter((seat) => seat.id.slice(seat.id.indexOf(".") + 1) === CHIEF_OF_STAFF);
  if (found.length === 0) return { kind: "none" };
  return found.length === 1 ? { kind: "one", seat: found[0]! } : { kind: "several", seats: found };
}

/** Whether a row is running. */
const isRunning = (row: BoardRow) => readStatus(row.status) === "in_progress";

/** The first failed board read, if any. */
function boardFailure(snapshot: LoadedSnapshot): Failure | undefined {
  for (const boards of Object.values(snapshot.boards)) if (!boards.ok) return boards.failure;
  return undefined;
}

/**
 * The shift summary's numbers (D1, BR-4): the asks waiting on the person, as
 * Inbox lists them, and the runs going with how many workstreams they run in,
 * from the rows Tasks reads. Each line fails on its own read (BR-8).
 */
export function shiftSummary(snapshot: LoadedSnapshot): {
  asks: Section<Ask[]>;
  running: Section<{ runs: number; workstreams: number }>;
} {
  const failed = snapshot.inventory.ok ? boardFailure(snapshot) : snapshot.inventory.failure;
  const running = openRows(snapshot).filter(isRunning);
  return {
    asks: snapshot.asks,
    running:
      failed === undefined
        ? { ok: true, value: { runs: running.length, workstreams: new Set(running.map((row) => row.holderSessionId)).size } }
        : { ok: false, failure: failed },
  };
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
