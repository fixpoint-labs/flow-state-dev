/**
 * What the screens compute from one snapshot, kept out of the components so
 * every surface computes it the same way.
 */
import { columnFor, isDone, readStatus } from "./columns";
import {
  STAFF_TEAM,
  type Ask,
  type BoardRow,
  type Failure,
  type LabSnapshot,
  type Project,
  type Section,
  type Worker,
  type Workstream,
  workerOf,
} from "./reads";

/** A loaded snapshot (not a refusal, not an unreachable Lab). */
export type LoadedSnapshot = Exclude<LabSnapshot, { refused: Failure } | { unreachable: Failure }>;

/** Every row on every attached board that loaded, across workstreams. */
export function allRows(snapshot: LoadedSnapshot): BoardRow[] {
  return Object.values(snapshot.boards).flatMap((boards) => (boards.ok ? boards.value.rows : []));
}

/**
 * What a row's board is called on a screen: the workstream's id, or, for a
 * conversation's board, the worker that conversation is with (`@<worker>`),
 * else the conversation's id.
 */
export function holderOf(snapshot: LoadedSnapshot, row: BoardRow): string {
  if (snapshot.inventory.ok && snapshot.inventory.value.workstreams.some((w) => w.id === row.mailboxId)) return row.mailboxId;
  const session = snapshot.sessions.find((s) => s.id === row.mailboxId);
  const worker = session === undefined ? null : workerOf(session);
  return worker === null ? row.mailboxId : `@${worker}`;
}

/** The rows Tasks shows: every attached board's, excluding done ones (BR-15). */
export function openRows(snapshot: LoadedSnapshot): BoardRow[] {
  return allRows(snapshot).filter((row) => !isDone(row.status));
}

/** The workers and workstreams a row's assignee is resolved against. */
export type Roster = { workers: readonly Worker[]; workstreams: readonly Workstream[] };

/**
 * The worker a row is held by, or `undefined` when no single worker is.
 *
 * A row names an `assignee`, which is a routing key a board's workers answer
 * to, not a worker address: a board may name `<name>` for the worker
 * `<team>.<name>`. So, in order:
 *
 * 1. the worker whose id is the assignee;
 * 2. the one worker whose own name is the assignee;
 * 3. when that name belongs to workers in more than one team, the one of them
 *    that is a member of the row's mailbox.
 *
 * Still more than one, or none, is no worker: a row is never shown against
 * several workers, or against a guess. Which worker actually claimed the row is
 * not published to a browser, and a declared assignee-to-worker map is
 * FIX-1672's.
 */
export function workerFor(roster: Roster, row: BoardRow): Worker | undefined {
  if (row.assignee === null) return undefined;
  const exact = roster.workers.find((worker) => worker.id === row.assignee);
  if (exact !== undefined) return exact;
  const named = roster.workers.filter((worker) => worker.name === row.assignee);
  if (named.length <= 1) return named[0];
  const members = new Set(roster.workstreams.find((w) => w.id === row.mailboxId)?.members ?? []);
  const inMailbox = named.filter((worker) => members.has(worker.id));
  return inMailbox.length === 1 ? inMailbox[0] : undefined;
}

/** A worker's shift status, the one word Roster, the sidebar and the workstream panel draw. */
export type ShiftStatus = "on shift" | "on call" | "off shift";

/** The three statuses, in the order Roster groups them. */
export const SHIFT_STATUSES: readonly ShiftStatus[] = ["on shift", "on call", "off shift"];

/** One worker's state: its status, the tasks it holds, and the asks it waits on you with. */
export type WorkerState = {
  worker: Worker;
  status: ShiftStatus;
  /** Its rows that are running or waiting on you, in board order: its slots in use. */
  held: BoardRow[];
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
 * - **on shift**: it holds a running row;
 * - **on call**: otherwise, it holds a row waiting on you (the legacy
 *   `awaiting_review` included) or has a pending ask;
 * - **off shift**: neither. Queued, blocked, errored and finished rows hold no
 *   slot.
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
    roster.workers.map((worker) => [worker.id, { worker, status: "off shift", held: [], asks: [] }]),
  );
  for (const row of allRows(snapshot)) {
    const status = readStatus(row.status);
    if (status !== "in_progress" && status !== "parked") continue;
    const owner = workerFor(roster, row);
    if (owner !== undefined) workers.get(owner.id)?.held.push(row);
  }
  for (const ask of snapshot.asks.ok ? snapshot.asks.value : []) {
    if (ask.workerId !== null) workers.get(ask.workerId)?.asks.push(ask);
  }
  for (const state of workers.values()) {
    state.status = state.held.some((row) => readStatus(row.status) === "in_progress")
      ? "on shift"
      : state.held.length > 0 || state.asks.length > 0
        ? "on call"
        : "off shift";
  }
  const result = { workers, partial: !snapshot.asks.ok };
  computed.set(snapshot, result);
  return result;
}

/** The workers and workstreams of a snapshot whose inventory loaded; empty otherwise. */
export function rosterOf(snapshot: LoadedSnapshot): Roster {
  return snapshot.inventory.ok ? snapshot.inventory.value : { workers: [], workstreams: [] };
}

/**
 * The asks a workstream's Stream shows (BR-18): the Inbox's asks whose worker is
 * one of the mailbox's members, in Inbox's order.
 */
export function asksFor(workstream: Workstream, asks: readonly Ask[]): Ask[] {
  const members = new Set(workstream.members);
  return asks.filter((ask) => ask.workerId !== null && members.has(ask.workerId));
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
 * The workstreams an ask belongs to: the mailbox whose post started the run,
 * when there is one, otherwise every mailbox the worker is a member of.
 */
export function workstreamsOf(ask: Ask, workstreams: readonly Workstream[]): Workstream[] {
  const parent = workstreams.find((w) => w.id === ask.parentSessionId);
  if (parent !== undefined) return [parent];
  return ask.workerId === null ? [] : workstreams.filter((w) => w.members.includes(ask.workerId!));
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
 * The rows a `@worker` line can go to (BR-19): the worker's rows on this
 * workstream's boards that are running, parked, or pending with a run linked.
 */
export function messageableRows(roster: Roster, rows: readonly BoardRow[], worker: Worker): BoardRow[] {
  return rows.filter((row) => {
    if (workerFor(roster, row)?.id !== worker.id) return false;
    const status = readStatus(row.status);
    return status === "in_progress" || status === "parked" || (status === "pending" && row.run !== null);
  });
}

/**
 * The member a `@name` line addresses: a member of the workstream whose worker
 * id, or whose own name, is `name`. `undefined` when none, or more than one.
 */
export function addressedWorker(roster: Roster, workstream: Workstream, name: string): Worker | undefined {
  const members = new Set(workstream.members);
  const found = roster.workers.filter((worker) => members.has(worker.id) && (worker.id === name || worker.name === name));
  return found.length === 1 ? found[0] : undefined;
}

/**
 * What to type after `@` to reach `worker` in `workstream`: its short name, or
 * its full id when another member shares that name, so the line always
 * resolves through {@link addressedWorker} to this worker.
 */
export function mentionOf(roster: Roster, workstream: Workstream, worker: Worker): string {
  return addressedWorker(roster, workstream, worker.name)?.id === worker.id ? worker.name : worker.id;
}

/**
 * The members of `workstream` running a task on its boards, in member order,
 * at most three: who the workstream composer offers to `@` (v2:1265). A
 * running task is one in progress; no shipped status means *in review* yet.
 */
export function liveWorkers(snapshot: LoadedSnapshot, workstream: Workstream): Worker[] {
  const boards = snapshot.boards[workstream.id];
  if (boards === undefined || !boards.ok) return [];
  const roster = rosterOf(snapshot);
  const running = new Set(
    boards.value.rows.filter((row) => readStatus(row.status) === "in_progress").map((row) => workerFor(roster, row)?.id),
  );
  return workstream.members
    .map((member) => roster.workers.find((worker) => worker.id === member))
    .filter((worker): worker is Worker => worker !== undefined && running.has(worker.id))
    .slice(0, 3);
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
 * The teams in the worker inventory, each with its workers, in first-seen order,
 * with the org workers' Staff group first.
 */
export function teamsOf(workers: readonly Worker[]): Array<{ team: string; workers: Worker[] }> {
  const teams = new Map<string, Worker[]>();
  for (const worker of workers) teams.set(worker.team, [...(teams.get(worker.team) ?? []), worker]);
  const all = [...teams].map(([team, members]) => ({ team, workers: members }));
  return [...all.filter((t) => t.team === STAFF_TEAM), ...all.filter((t) => t.team !== STAFF_TEAM)];
}

/** PROJECTS: every project, then the mailbox workstreams, which sit under No project. */
export type ProjectsView = { projects: Project[]; noProject: Workstream[] };

/**
 * PROJECTS (BR-22, D3): every project the person reads, shared ones and their
 * own private ones, then every mailbox workstream the inventory registers,
 * which is No project. A project lists no mailbox, including a row that still
 * carries `workstreams`.
 *
 * Derived from the snapshot alone: no read of its own.
 * Fails when either read it groups did: the inventory's failure first, since
 * without it no workstream can be placed.
 */
export function projectsOf(snapshot: LoadedSnapshot): Section<ProjectsView> {
  if (!snapshot.inventory.ok) return snapshot.inventory;
  if (!snapshot.projects.ok) return snapshot.projects;
  return { ok: true, value: { projects: snapshot.projects.value.rows, noProject: snapshot.inventory.value.workstreams } };
}


/** How many workers are in each status, and how many waits-on entries they have. */
export type ShiftCounts = Record<ShiftStatus, number> & {
  /** Each held task waiting on you plus each pending ask, across the workers counted. */
  waiting: number;
};

/** The counts over every worker in `states`, or over one team's. */
export function shiftCounts(states: WorkerStates, team?: string): ShiftCounts {
  const counts: ShiftCounts = { "on shift": 0, "on call": 0, "off shift": 0, waiting: 0 };
  for (const { worker, status, held, asks } of states.workers.values()) {
    if (team !== undefined && worker.team !== team) continue;
    counts[status] += 1;
    counts.waiting += held.filter((row) => readStatus(row.status) === "parked").length + asks.length;
  }
  return counts;
}

/** The team a Roster address picks, or `null` (All) when the inventory has no such team. */
export function pickedTeam(workers: readonly Worker[], team: string | null): string | null {
  return team !== null && workers.some((worker) => worker.team === team) ? team : null;
}

/**
 * The name a worker must carry to be the chief of staff: an org worker's id, or a
 * team worker's name. The only place Shift Manager names a worker (D2).
 */
const CHIEF_OF_STAFF = "chief-of-staff";

/** Which worker Shift Manager talks to as the chief of staff, if exactly one is. */
export type ChiefOfStaff = { kind: "one"; worker: Worker } | { kind: "none" } | { kind: "several"; workers: Worker[] };

/**
 * The chief of staff among the inventory's workers (D2): the workers whose name is
 * exactly `chief-of-staff`. That is an org worker (`chief-of-staff`) or a
 * team's worker (`<team>.chief-of-staff`). One is the chief of staff; two or
 * more are a state, never a guess.
 */
export function chiefOfStaffOf(workers: readonly Worker[]): ChiefOfStaff {
  const found = workers.filter((worker) => worker.id.slice(worker.id.indexOf(".") + 1) === CHIEF_OF_STAFF);
  if (found.length === 0) return { kind: "none" };
  return found.length === 1 ? { kind: "one", worker: found[0]! } : { kind: "several", workers: found };
}

/** Whether a row is running. */
const isRunning = (row: BoardRow) => readStatus(row.status) === "in_progress";

/** The first failed board read among the loaded workstreams', if any. */
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
        ? { ok: true, value: { runs: running.length, workstreams: new Set(running.map((row) => row.mailboxId)).size } }
        : { ok: false, failure: failed },
  };
}

/**
 * One workstream's line in the rail's STREAMS. `needsYou` is `null` when the
 * asks did not load.
 */
export type StreamCount = { workstream: Workstream; running: Section<number>; needsYou: number | null };

/**
 * The rail's STREAMS (BR-19): each workstream with its running rows and its
 * members' pending asks, the asks its Stream shows. Fails whole only when the
 * inventory did; a workstream whose boards failed carries that failure.
 */
export function streamCounts(snapshot: LoadedSnapshot): Section<StreamCount[]> {
  if (!snapshot.inventory.ok) return snapshot.inventory;
  const asks = snapshot.asks;
  return {
    ok: true,
    value: snapshot.inventory.value.workstreams.map((workstream) => {
      const boards = snapshot.boards[workstream.id];
      const running: Section<number> =
        boards === undefined || boards.ok
          ? { ok: true, value: (boards?.value.rows ?? []).filter(isRunning).length }
          : { ok: false, failure: boards.failure };
      return { workstream, running, needsYou: asks.ok ? asksFor(workstream, asks.value).length : null };
    }),
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
