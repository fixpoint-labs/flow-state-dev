/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import type { InboxItem } from "@flow-state-dev/orchestration/inbox";
import { isDone } from "./columns";
import {
  GENERAL_TEAM,
  type Ask,
  type BoardRow,
  type Failure,
  type LabSnapshot,
  type Project,
  type Section,
  type Worker,
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
export function boardOwnerOf(snapshot: LoadedSnapshot, row: BoardRow): string {
  const session = snapshot.sessions.find((s) => s.id === row.ownerSessionId);
  if (session === undefined) return row.ownerSessionId;
  const workstream = workstreamOf(session);
  if (workstream !== null) return workstream;
  const worker = workerOf(session);
  return worker === null ? row.ownerSessionId : `@${worker}`;
}

/** The rows Tasks shows: every attached board's, excluding done ones (BR-15). */
export function openRows(snapshot: LoadedSnapshot): BoardRow[] {
  return allRows(snapshot).filter((row) => !isDone(row.status));
}

/** The workers a row's assignee is resolved against. */
export type Roster = { workers: readonly Worker[] };

/**
 * The worker a row is held by, or `undefined` when no single worker is.
 *
 * A row names an `assignee`, which is a routing key a board's workers answer
 * to, not a worker address: a board may name `<name>` for the worker
 * `<team>.<name>`. So, in order:
 *
 * 1. the worker whose id is the assignee;
 * 2. the one worker whose own name is the assignee.
 *
 * A name more than one worker carries, or none, is no worker: a row is never shown against
 * several workers, or against a guess. Which worker actually claimed the row is
 * not published to a browser, and a declared assignee-to-worker map is
 * FIX-1672's.
 */
export function workerFor(roster: Roster, row: BoardRow): Worker | undefined {
  if (row.assignee === null) return undefined;
  const exact = roster.workers.find((worker) => worker.id === row.assignee);
  if (exact !== undefined) return exact;
  const named = roster.workers.filter((worker) => worker.name === row.assignee);
  return named.length === 1 ? named[0] : undefined;
}

/** A worker's shift status, the one word Roster and the sidebar draw. */
export type ShiftStatus = "on shift" | "off shift";

/** The two statuses, in the order Roster groups them. */
export const SHIFT_STATUSES: readonly ShiftStatus[] = ["on shift", "off shift"];

/** One worker's state: its status, the tasks it holds, and the asks it waits on you with. */
export type WorkerState = {
  worker: Worker;
  status: ShiftStatus;
  /** Its rows that are running, waiting on you included, in board order: its slots in use. */
  held: BoardRow[];
  /** Of `held`, the rows held on a question or confirm for you (their Inbox item's board holds). */
  waitsOnYou: BoardRow[];
  /** Its pending asks, in Inbox's order. */
  asks: Ask[];
};

/** Every worker's state, and whether the result is partial. */
export type WorkerStates = {
  /** Keyed by worker id, in inventory order. */
  workers: Map<string, WorkerState>;
  /** Asks did not load: a worker waiting on you only through an ask reads off shift. */
  partial: boolean;
};

const computed = new WeakMap<LoadedSnapshot, WorkerStates>();

/**
 * Every worker's status, worked out once per snapshot from what the Lab records:
 * its rows (each resolved by {@link workerFor}) and its pending asks.
 *
 * - **on shift**: it holds a running row (one waiting on you included) or a
 *   pending ask;
 * - **off shift**: none of those. Queued, blocked, errored and finished rows
 *   hold no slot.
 *
 * A row no single worker resolves to, and an ask whose session names no worker in
 * the inventory, count for nobody. Asks that did not load leave every status
 * as the boards give it and mark the result `partial`.
 *
 * Every screen that draws a status or a count reads this result, and the same
 * snapshot always gets the same object.
 */
export function workerStates(snapshot: LoadedSnapshot): WorkerStates {
  const cached = computed.get(snapshot);
  if (cached !== undefined) return cached;
  const roster = rosterOf(snapshot);
  const workers = new Map<string, WorkerState>(
    roster.workers.map((worker) => [worker.id, { worker, status: "off shift", held: [], waitsOnYou: [], asks: [] }]),
  );
  for (const row of allRows(snapshot)) {
    if (row.status !== "in_progress") continue;
    const owner = workerFor(roster, row);
    if (owner === undefined) continue;
    const state = workers.get(owner.id);
    state?.held.push(row);
    if (waitsOnYou(snapshot, row)) state?.waitsOnYou.push(row);
  }
  for (const ask of snapshot.asks.ok ? snapshot.asks.value : []) {
    if (ask.workerId !== null) workers.get(ask.workerId)?.asks.push(ask);
  }
  for (const state of workers.values()) {
    state.status = state.held.length > 0 || state.asks.length > 0 ? "on shift" : "off shift";
  }
  const result = { workers, partial: !snapshot.asks.ok };
  computed.set(snapshot, result);
  return result;
}

/** The workers of a snapshot whose inventory loaded; empty otherwise. */
export function rosterOf(snapshot: LoadedSnapshot): Roster {
  return snapshot.inventory.ok ? snapshot.inventory.value : { workers: [] };
}

/**
 * The Inbox item that shows suspension `suspensionId`: a task's item when its
 * row holds it, else the ask's own. Its id when the Inbox didn't load or
 * doesn't list it, so a link still opens the Inbox.
 */
export function inboxItemIdOf(snapshot: LoadedSnapshot, suspensionId: string): string {
  const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
  return items.find((item) => item.questions.some((hold) => hold.id === suspensionId))?.id ?? suspensionId;
}

/**
 * The Inbox item a route names: by its id, else, for a link written when an
 * item's id was its suspension's (`/inbox/<suspensionId>`), the item one of
 * whose holds that suspension is. `null` when none.
 */
export function inboxItemAt(snapshot: LoadedSnapshot, id: string | null): InboxItem<Ask> | null {
  if (id === null) return null;
  const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
  return items.find((item) => item.id === id) ?? items.find((item) => item.questions.some((hold) => hold.id === id)) ?? null;
}

/**
 * Whether a task holds on a question or confirm for you (FIX-2131): its Inbox
 * item has a hold the board keeps on the row. A task waiting on its run's stop
 * for you (an approval, a review) shows that stop as an ask instead
 * ({@link asksOfTask}). `false` while the snapshot or its Inbox isn't read.
 */
export function waitsOnYou(snapshot: LabSnapshot | undefined, row: BoardRow | undefined): boolean {
  if (snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined || row === undefined || !snapshot.inbox.ok) return false;
  return snapshot.inbox.value.some(
    (item) => item.task?.board === row.boardRef && item.task.taskId === row.id && item.questions.some((hold) => hold.source.kind === "row"),
  );
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
 * The door of the flow that owns a session: the worker inventory rows of the
 * workers on that flow name it, since a worker flow is registered under its name.
 * Every worker on one flow shares its door. `null` when no worker row is on the
 * flow, or its worker flow takes no message.
 */
export function doorOf(workers: readonly Worker[], flowId: string): string | null {
  return workers.find((worker) => worker.kind === flowId)?.door ?? null;
}

/**
 * The teams in the worker inventory, each with its display name and its
 * workers, in first-seen order, with the org workers' General group first.
 */
export function teamsOf(workers: readonly Worker[]): Array<{ team: string; name: string; workers: Worker[] }> {
  const teams = new Map<string, Worker[]>();
  for (const worker of workers) {
    const team = teams.get(worker.team);
    if (team === undefined) teams.set(worker.team, [worker]);
    else team.push(worker);
  }
  const all = [...teams].map(([team, workers]) => ({ team, name: workers[0]!.teamName, workers }));
  return [...all.filter((t) => t.team === GENERAL_TEAM), ...all.filter((t) => t.team !== GENERAL_TEAM)];
}

/** PROJECTS: every project the user reads. */
export type ProjectsView = { projects: Project[] };

/**
 * PROJECTS (BR-22): every project the user reads, shared ones and their own
 * private ones. Derived from the snapshot alone: no read of its own. Fails when
 * the projects read did.
 */
export function projectsOf(snapshot: LoadedSnapshot): Section<ProjectsView> {
  if (!snapshot.projects.ok) return snapshot.projects;
  return { ok: true, value: { projects: snapshot.projects.value.rows } };
}


/** How many workers are in each status, and how many waits-on entries they have. */
export type ShiftCounts = Record<ShiftStatus, number> & {
  /** Each held task holding on a question for you plus each pending ask, across the workers counted. */
  waiting: number;
};

/** The counts over every worker in `states`, or over one team's. */
export function shiftCounts(states: WorkerStates, team?: string): ShiftCounts {
  const counts: ShiftCounts = { "on shift": 0, "off shift": 0, waiting: 0 };
  for (const { worker, status, waitsOnYou, asks } of states.workers.values()) {
    if (team !== undefined && worker.team !== team) continue;
    counts[status] += 1;
    counts.waiting += waitsOnYou.length + asks.length;
  }
  return counts;
}

/** The team a Roster address picks, or `null` (All) when the inventory has no such team. */
export function pickedTeam(workers: readonly Worker[], team: string | null): string | null {
  return team !== null && workers.some((worker) => worker.team === team) ? team : null;
}

/**
 * The name a worker must carry to be the Shift Coordinator: an org worker's id, or a
 * team worker's name. The only place Shift Manager names a worker (D2).
 */
const SHIFT_COORDINATOR = "shift-coordinator";

const isShiftCoordinator = (idOrName: string) => idOrName.slice(idOrName.indexOf(".") + 1) === SHIFT_COORDINATOR;

/** How the screens name a worker: `shift-coordinator` is the Shift Coordinator. */
export function workerLabel(idOrName: string): string {
  return isShiftCoordinator(idOrName) ? "Shift Coordinator" : idOrName;
}

/** Which worker Shift Manager talks to as the Shift Coordinator, if exactly one is. */
export type ShiftCoordinator = { kind: "one"; worker: Worker } | { kind: "none" } | { kind: "several"; workers: Worker[] };

/**
 * The Shift Coordinator among the inventory's workers (D2): the workers whose name is
 * exactly `shift-coordinator`. That is an org worker (`shift-coordinator`) or a
 * team's worker (`<team>.shift-coordinator`). One is the Shift Coordinator; two or
 * more are a state, never a guess.
 */
export function shiftCoordinatorOf(workers: readonly Worker[]): ShiftCoordinator {
  const found = workers.filter((worker) => isShiftCoordinator(worker.id));
  if (found.length === 0) return { kind: "none" };
  return found.length === 1 ? { kind: "one", worker: found[0]! } : { kind: "several", workers: found };
}

/** Whether a row is running. */
const isRunning = (row: BoardRow) => row.status === "in_progress";

/** The first failed board read, if any. */
function boardFailure(snapshot: LoadedSnapshot): Failure | undefined {
  for (const boards of Object.values(snapshot.boards)) if (!boards.ok) return boards.failure;
  return undefined;
}

/**
 * The shift summary's numbers (D1, BR-4): what waits on the user, as Inbox
 * lists it (one item per task held on a question, a review or an approval,
 * and per ask no task holds, FIX-2131); the asks the worker sessions hold,
 * each drawn as a card; and the runs going with how many workstreams they run
 * in, from the rows Tasks reads. Each line fails on its own read (BR-8).
 */
export function shiftSummary(snapshot: LoadedSnapshot): {
  inbox: Section<InboxItem<Ask>[]>;
  asks: Section<Ask[]>;
  running: Section<{ runs: number; workstreams: number }>;
} {
  const boardsFailed = boardFailure(snapshot);
  const failed = snapshot.inventory.ok ? boardsFailed : snapshot.inventory.failure;
  const running = openRows(snapshot).filter(isRunning);
  return {
    inbox: snapshot.inbox,
    asks: snapshot.asks,
    running:
      failed === undefined
        ? { ok: true, value: { runs: running.length, workstreams: new Set(running.map((row) => row.ownerSessionId)).size } }
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
