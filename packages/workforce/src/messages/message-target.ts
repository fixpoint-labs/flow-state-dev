/**
 * Where a message addressed to a task or a session lands (FIX-2160), checked
 * before anything is written.
 *
 * `{ task: id }` lands in the session that works the task: the conversation
 * ledger finds the row by id (its id index), and the row's run link names the
 * session. `{ session: id }` lands in that conversation of the user's. Both are
 * then checked the same way, on the session's own record as the engine reads
 * it for this user (`requestHost.sessions.read`): the user, their organization
 * and tenant, the worker it runs and that worker's flow now. A task's session
 * skips the markers check (it is a task session by design) and adds one of its
 * own: a worker that hears only in its tasks' sessions (the coder) is refused
 * while a task there is open, since its only answer would resume the coding
 * session the work is in.
 *
 * {@link checkTargetSession} is the check on its own, for a send that already
 * knows the session: a resend reruns it on the session its row names.
 */
import type { BlockContext, SessionView } from "@flow-state-dev/core/types";
import {
  findTaskPartitions,
  isTerminalStatus,
  rowsInSession,
  type TaskCollectionRef
} from "@flow-state-dev/orchestration/tasks";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "../conversation-board/ledger";
import type { RosterWorker, WorkerInstallation } from "../workers/installation";
import { FILING_SESSION_STATE_KEY, TASK_ID_STATE_KEY, WORKER_ID_STATE_KEY } from "../workers/keys";
import { messageHearingOf } from "./message-received-entry";

/** A message's target: a worker by its id, a task by its id, or one of the user's conversations by its session id. */
export type MessageTarget = string | { readonly task: string } | { readonly session: string };

/** A target the check let through: the session it lands in, and the worker that runs it. */
export interface CheckedTarget {
  readonly sessionId: string;
  readonly worker: RosterWorker;
}

/** What a check came to: the target, or a refusal for the model. */
export type TargetCheck = { readonly ok: true; readonly target: CheckedTarget } | { readonly ok: false; readonly error: string };

const refuse = (error: string): TargetCheck => ({ ok: false, error });

/**
 * Check a session a message would land in, before anything is written.
 *
 * @param of What the session was reached by: a `{ session }` as typed, or a
 *   task's session, with the ledger the task is on (its rows decide whether
 *   a coding task there still runs).
 */
export async function checkTargetSession(
  ctx: BlockContext,
  installation: WorkerInstallation,
  sessionId: string,
  of: { readonly session: true } | { readonly task: string; readonly ledger: TaskCollectionRef }
): Promise<TargetCheck> {
  const viaTask = "task" in of;
  const notFound = viaTask
    ? `no_task_session: no task "${of.task}" of yours has a session to message. A task that hasn't started has none.`
    : `no_session: no conversation "${sessionId}" of yours.`;
  const sessions = ctx.requestHost?.sessions;
  if (sessions === undefined) return refuse(`${notFound} (This host can't check a session, so only a worker's name reaches one.)`);
  const view: SessionView | undefined = await sessions.read(sessionId);
  if (view === undefined) return refuse(notFound);

  const state = view.state;
  if (!viaTask && (state[TASK_ID_STATE_KEY] != null || state[FILING_SESSION_STATE_KEY] != null)) {
    return refuse(
      `not_a_conversation: "${sessionId}" is a session working a task, not a conversation. Message the task with to: { task: id }.`
    );
  }
  const workerId = state[WORKER_ID_STATE_KEY];
  const worker = typeof workerId === "string" ? await installation.rosterWorker(ctx as never, workerId) : undefined;
  if (worker === undefined) return refuse(`no_worker: the worker in "${sessionId}" isn't on your roster now.`);
  if (worker.problem !== undefined) return refuse(`worker_unavailable: worker "${worker.id}" can't be messaged: ${worker.problem}.`);
  if ((view.flowId ?? view.flowKind) !== worker.flow) {
    return refuse(`worker_unavailable: worker "${worker.id}" has moved to another flow since "${sessionId}" was opened.`);
  }

  if (messageHearingOf(installation.workerFlows()[worker.flow]?.flow) === "task-sessions") {
    if (!viaTask) {
      return refuse(
        `not_a_conversation: "${worker.id}" has no conversations; it answers only from its tasks' sessions. Message one of its tasks with to: { task: id }.`
      );
    }
    // The task and its follow-ups, which run in that session one at a time.
    if (rowsInSession(of.ledger, sessionId).some((row) => !isTerminalStatus(row.status))) {
      return refuse(
        `task_running: task "${of.task}" is still running, and a message would reach the work itself. ` +
          `Read it with getTask, or message it once it has ended.`
      );
    }
  }
  if (sessionId === ctx.session.identity.id) return refuse("not_yourself: that is the session you're writing from.");
  return { ok: true, target: { sessionId, worker } };
}

/**
 * Resolve `{ task: id }` to the session its run named, then check it.
 * No row, no run link (not started, or a plan step), an id held in more than
 * one of the user's conversations, and another user's: one refusal,
 * `no_task_session`, so it says nothing of another user's tasks.
 */
export async function checkTaskTarget(
  ctx: BlockContext,
  installation: WorkerInstallation,
  taskId: string
): Promise<TargetCheck> {
  const notFound = refuse(`no_task_session: no task "${taskId}" of yours has a session to message. A task that hasn't started has none.`);
  // Only partitions that hold the row count: a marker is written before its
  // row, so a failed add leaves one behind.
  const held: TaskCollectionRef[] = [];
  for (const partition of await findTaskPartitions(ctx, CONVERSATION_LEDGER_ID, taskId)) {
    const ledger = await conversationLedgerAt(ctx, partition);
    if (ledger?.get(taskId) !== undefined) held.push(ledger);
  }
  if (held.length !== 1) return notFound;
  const ledger = held[0]!;
  const sessionId = ledger.get(taskId)?.run?.sessionId;
  if (sessionId == null) return notFound;
  return checkTargetSession(ctx, installation, sessionId, { task: taskId, ledger });
}
