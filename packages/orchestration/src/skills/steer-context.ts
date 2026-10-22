/**
 * How a running request takes a steer (FIX-2086): a context entry re-read
 * before every model call. Nothing is stopped, no attempt is used, and
 * nothing settles.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { currentWorkerClaim } from "../task-board/flow-policy-wiring";
import { isTaskTurn } from "../task-board/task-turn";
import {
  readCommittedTask,
  steersTakenIn,
  ticketForClaim,
  untakenSteers,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
} from "../tasks";

/** One steer as a worker is shown it: the words, and who sent them. */
export interface ShownSteer {
  readonly message: string;
  readonly from: "filer" | "user";
}

/** Who sent a steer, in a worker's words. */
function senderOf(from: ShownSteer["from"]): string {
  return from === "user" ? "the user" : "whoever assigned you the task";
}

/**
 * Steers as a worker reads them: a lead line, then each steer with its
 * sender, oldest first. Shared by the brief, the turn a late steer owes, the
 * context entry and a coding run's prompt, so a worker reads one shape.
 *
 * @param lead What the steers are, for this reader.
 */
export function renderSteers(steers: readonly ShownSteer[], lead: string): string {
  return [lead, ...steers.map((steer) => `- From ${senderOf(steer.from)}: ${steer.message.split("\n").join("\n  ")}`)].join(
    "\n"
  );
}

/** The lead the context entry shows a running request's steers under. */
export const STEERED_WHILE_RUNNING =
  "While you were working on this task, you were sent the messages below about it. They change what to do from " +
  "here: carry on from where you are, following them.";

/** The row a running request holds, and the ticket that proves it. */
export interface RunningTask {
  readonly claim: TaskClaimTicket;
  readonly ledger: TaskCollectionRef;
  readonly row: Task;
}

/**
 * The task the running request works, on the ledger `resolve` answers, or
 * `undefined` when it works none there. Server-set state only: the claim the
 * gate or an admission stamped, else the in-progress row whose run link names
 * this session and this request. An inline plan step runs inside its task's
 * request, so it reads that task's steers.
 */
export async function runningTaskOf(
  resolve: (ctx: BlockContext) => Promise<TaskCollectionRef | undefined>,
  ctx: BlockContext
): Promise<RunningTask | undefined> {
  if (!isTaskTurn(ctx)) return undefined;
  const ledger = await resolve(ctx);
  if (ledger === undefined) return undefined;
  const stamped = currentWorkerClaim(ctx);
  if (stamped !== undefined && stamped.collectionId === ledger.collectionId && stamped.partition === ledger.partition) {
    const row = ledger.get(stamped.taskId);
    return row === undefined ? undefined : { claim: stamped, ledger, row };
  }
  const sessionId = ctx.session?.identity?.id;
  const requestId = ctx.request?.identity?.id;
  if (sessionId === undefined || requestId === undefined) return undefined;
  const row = ledger
    .list({ status: "in_progress" })
    .find((task) => task.run?.sessionId === sessionId && task.run.requestId === requestId && task.run.attempt === task.attempts);
  return row === undefined ? undefined : { claim: ticketForClaim(ledger.collectionId, row, ledger.partition), ledger, row };
}

/**
 * Take the steers no request of `running`'s attempt has taken, in the read
 * named `takenIn`, and answer every steer this attempt took in that read
 * (a re-run of the read after a crash reads them again). The claim's steers
 * are already in the brief, and a late steer's turn carries its own. Empty
 * when the board takes no steers or its claim moved on.
 */
export async function takeRunningSteers(running: RunningTask, takenIn: string): Promise<ShownSteer[]> {
  const { ledger, claim, row } = running;
  if (ledger.takeSteers === undefined || row.status !== "in_progress") return [];
  // Nothing new as stored (a steer is another request's write, so the row
  // this request first read can't say): a read, no write. A steer that lands
  // after it is taken before the next model call, or by the gate's check.
  const stored = (await readCommittedTask(ledger, row.id)) ?? row;
  if (untakenSteers(stored).length === 0) return steersTakenIn(stored, takenIn).map(({ message, from }) => ({ message, from }));
  const outcome = await ledger.takeSteers(row.id, { claim, takenIn });
  if (outcome.outcome === "declined") return [];
  const now = ledger.get(row.id);
  return now === undefined ? [] : steersTakenIn(now, takenIn).map(({ message, from }) => ({ message, from }));
}

/** {@link createSteerContext}'s options: where it reads the row the request holds. */
export interface SteerContextOptions {
  /**
   * The ledger the running request's task is on, read from server-set state
   * (the session's birth fields, say), never from input (BP-031).
   */
  readonly resolve: (ctx: BlockContext) => Promise<TaskCollectionRef | undefined>;
}

/**
 * The context entry a worker's model takes steers through: a function-form
 * entry, so the generator re-runs it before every model call. `null` when the
 * request works no task or has taken none.
 */
export function createSteerContext(options: SteerContextOptions) {
  return async (_input: unknown, ctx: BlockContext): Promise<string | null> => {
    const running = await runningTaskOf(options.resolve, ctx);
    const requestId = ctx.request?.identity?.id;
    if (running === undefined || requestId === undefined) return null;
    const steers = await takeRunningSteers(running, `step:${requestId}`);
    return steers.length === 0 ? null : renderSteers(steers, STEERED_WHILE_RUNNING);
  };
}
