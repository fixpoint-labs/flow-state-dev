/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import { columnFor, isDone, readStatus } from "./columns";
import type { Ask, BoardRow, LabSnapshot, Seat, Workstream } from "./reads";

/** A loaded snapshot (not a refusal). */
export type LoadedSnapshot = Exclude<LabSnapshot, { refused: unknown }>;

/** Every row on every attached board that loaded, across workstreams. */
export function allRows(snapshot: LoadedSnapshot): BoardRow[] {
  return Object.values(snapshot.boards).flatMap((boards) => (boards.ok ? boards.value.rows : []));
}

/** The rows Tasks shows: every attached board's, excluding done ones (BR-15). */
export function openRows(snapshot: LoadedSnapshot): BoardRow[] {
  return allRows(snapshot).filter((row) => !isDone(row.status));
}

/**
 * Whether a row is held by a seat.
 *
 * A row names an `assignee`, which is a routing key a board's workers answer
 * to, not a seat address: a board may name `<name>` for the seat `<team>.<name>`.
 * So a row is the seat's when its assignee is the seat's id or the seat's own
 * name. Which seat actually claimed the row is not published to a browser.
 */
export function holds(seat: Seat, row: BoardRow): boolean {
  return row.assignee !== null && (row.assignee === seat.id || row.assignee === seat.name);
}

/** A worker's status (BR-8). */
export type WorkerStatus = "working" | "waiting on you" | "idle";

/** *working* with a running row, *waiting on you* with a parked one, *idle* otherwise. */
export function workerStatus(seat: Seat, rows: readonly BoardRow[]): WorkerStatus {
  const held = rows.filter((row) => holds(seat, row));
  if (held.some((row) => readStatus(row.status) === "in_progress")) return "working";
  if (held.some((row) => readStatus(row.status) === "parked")) return "waiting on you";
  return "idle";
}

/** The seat a row is held by, when one matches. */
export function seatFor(seats: readonly Seat[], row: BoardRow): Seat | undefined {
  return seats.find((seat) => holds(seat, row));
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
