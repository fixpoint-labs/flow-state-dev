/**
 * Who is on shift, and the counts every screen draws from it: the worker
 * directory (`workers.ts`) against the Inbox view's one answer. A worker's
 * held tasks are the view's `tasks`, each resolved by {@link workerFor}; its
 * asks are the view's suspension holds, by the `workerId` the view stamped on
 * each. So a worker's status and the Inbox list move in the same view update,
 * and never disagree.
 *
 * Also the names and groupings the directory's screens share: teams, the
 * Shift Coordinator, a flow's door.
 */
import type { InboxHold, InboxItem } from "@flow-state-dev/orchestration/inbox";
import type { InboxBoardTask, InboxSuspensionDetail, InboxViewValue } from "@flow-state-dev/workforce/browser";
import { GENERAL_TEAM, type Worker } from "./workers";

/** One of the Inbox view's holds, each suspension carrying its ask's detail. */
type ViewHold = InboxHold<InboxSuspensionDetail>;

// FIX-1672.
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
 * A name more than one worker carries, or none, is no worker: a row is never
 * shown against several workers, or against a guess.
 */
export function workerFor(workers: readonly Worker[], task: { assignee: string | null }): Worker | undefined {
  if (task.assignee === null) return undefined;
  const exact = workers.find((worker) => worker.id === task.assignee);
  if (exact !== undefined) return exact;
  const named = workers.filter((worker) => worker.name === task.assignee);
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
  /** Its tasks that are running, waiting on you included, in board order: its slots in use. */
  held: InboxBoardTask[];
  /** Of `held`, the tasks held on a question or confirm for you (their Inbox item's board holds). */
  waitsOnYou: InboxBoardTask[];
  /** Its pending asks, oldest first: the Inbox's suspension holds that name it. */
  asks: ViewHold[];
};

/** Every worker's state, and whether the result is partial. */
export type WorkerStates = {
  /** Keyed by worker id, in the directory's order. */
  workers: Map<string, WorkerState>;
  /** The Inbox view did not load: every worker reads off shift, as far as this page knows. */
  partial: boolean;
};

/** Whether `item` holds its task on a question or confirm for you. */
const holdsTask = (item: InboxItem<InboxSuspensionDetail>) => item.holds.some((hold) => hold.source.kind === "task");

/**
 * Every worker's status, from the Inbox view's answer (`undefined` while it is
 * unread or failed):
 *
 * - **on shift**: it holds a running task (one waiting on you included) or a
 *   pending ask;
 * - **off shift**: none of those. Queued, blocked, errored and finished tasks
 *   hold no slot.
 *
 * A task no single worker resolves to, and an ask whose session names no
 * worker in the directory (a run with no conversation among them), count for
 * nobody. Every screen that draws a status or a count reads this result.
 */
export function workerStates(workers: readonly Worker[], view: InboxViewValue | undefined): WorkerStates {
  const states = new Map<string, WorkerState>(
    workers.map((worker) => [worker.id, { worker, status: "off shift", held: [], waitsOnYou: [], asks: [] }]),
  );
  for (const task of view?.tasks ?? []) {
    if (task.status !== "in_progress") continue;
    const owner = workerFor(workers, task);
    const state = owner === undefined ? undefined : states.get(owner.id);
    if (state === undefined) continue;
    state.held.push(task);
    const item = view?.items.find((each) => each.task?.board === task.boardRef && each.task.taskId === task.id);
    if (item !== undefined && holdsTask(item)) state.waitsOnYou.push(task);
  }
  const asks = (view?.items ?? []).flatMap((item) => item.holds.filter((hold) => hold.source.kind === "suspension")).sort((a, b) => a.openedAt - b.openedAt);
  for (const hold of asks) {
    const workerId = hold.detail?.workerId ?? null;
    if (workerId !== null) states.get(workerId)?.asks.push(hold);
  }
  for (const state of states.values()) {
    state.status = state.held.length > 0 || state.asks.length > 0 ? "on shift" : "off shift";
  }
  return { workers: states, partial: view === undefined };
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

/**
 * The door of the flow that owns a session: the inventory rows of the workers
 * on that flow name it, since a worker flow is registered under its name.
 * Every worker on one flow shares its door. `null` when no worker is on the
 * flow, or its worker flow takes no message.
 */
export function doorOf(workers: readonly Worker[], flowId: string): string | null {
  return workers.find((worker) => worker.kind === flowId)?.door ?? null;
}

/**
 * The teams of the directory, each with its display name and its workers, in
 * first-seen order, with the org workers' General group first.
 */
export function teamsOf(workers: readonly Worker[]): Array<{ team: string; name: string; workers: Worker[] }> {
  const teams = new Map<string, Worker[]>();
  for (const worker of workers) {
    const team = teams.get(worker.team);
    if (team === undefined) teams.set(worker.team, [worker]);
    else team.push(worker);
  }
  const all = [...teams].map(([team, onTeam]) => ({ team, name: onTeam[0]!.teamName, workers: onTeam }));
  return [...all.filter((t) => t.team === GENERAL_TEAM), ...all.filter((t) => t.team !== GENERAL_TEAM)];
}

/** The team a Roster address picks, or `null` (All) when the directory has no such team. */
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
 * The Shift Coordinator among the directory's workers (D2): the workers whose
 * name is exactly `shift-coordinator`, an org worker or a team's. One is the
 * Shift Coordinator; two or more are a state, never a guess.
 */
export function shiftCoordinatorOf(workers: readonly Worker[]): ShiftCoordinator {
  const found = workers.filter((worker) => isShiftCoordinator(worker.id));
  if (found.length === 0) return { kind: "none" };
  return found.length === 1 ? { kind: "one", worker: found[0]! } : { kind: "several", workers: found };
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
