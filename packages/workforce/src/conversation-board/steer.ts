/**
 * A line in a worker's task session, and the turn a late steer is owed
 * (FIX-2086). Every choice reads server-set state (BP-031).
 */
import { handler, router, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext, type BlockDefinition, type ConcurrencyConfig } from "@flow-state-dev/core/types";
import { renderSteers, runningTaskOf, takeRunningSteers, type ShownSteer } from "@flow-state-dev/orchestration";
import { afterTaskCheck, noteTaskAnswer, packWorkerInput, STEER_TURN_DUE_MS } from "@flow-state-dev/orchestration/task-board";
import { isTerminalStatus, type Task, type TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z, type ZodTypeAny } from "zod";
import { STEER_TURN_ENTRY } from "./board-entries";
import { conversationLedgerAt, conversationLedgerResources } from "./ledger";
import { admitOwnTask } from "./task-admission";
import { AFTER_REPLY_CONCURRENCY } from "./task-settled";
import { filingPartitionOf, sessionTaskOf } from "./task-entry";

export { STEER_TURN_ENTRY } from "./board-entries";

/** The lead the turn a late steer is owed opens with. */
export const STEERED_AFTER_ANSWER =
  "You were sent the messages below about this task after your last model call. Act on them, then answer again. " +
  "A checkpoint you reported stands as the task's output unless you report a new one.";

/** The ledger a task session's task is on: the conversation it was opened for. */
async function sessionLedger(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const partition = filingPartitionOf(ctx);
  return partition === undefined ? undefined : conversationLedgerAt(ctx, partition);
}

/**
 * The open task this session works: the task it was opened for, or the
 * latest of its follow-ups, when that one has not finished. `undefined`
 * outside a task session, and once the latest has finished.
 */
export async function sessionOpenTask(ctx: BlockContext): Promise<{ ledger: TaskCollectionRef; row: Task } | undefined> {
  const taskId = sessionTaskOf(ctx);
  if (taskId === undefined) return undefined;
  const ledger = await sessionLedger(ctx);
  if (ledger === undefined) return undefined;
  const rows = ledger.list().filter((task) => (task.followUpOf ?? task.id) === taskId) as Task[];
  if (rows.length === 0) return undefined;
  const latest = rows.reduce((last, task) => (task.createdAt > last.createdAt ? task : last));
  return isTerminalStatus(latest.status) ? undefined : { ledger, row: latest };
}

/**
 * Start the turn owed to `row`'s untaken steer (D2), in the session its run
 * link names: the wake first, so a lost start is still paid, then the entry at
 * once. A row with no run in a session yet has no turn to start: its next
 * attempt's brief carries the steer.
 *
 * @param flowKind The flow that session runs on, when it isn't the running one.
 */
export async function startOwedSteerTurn(ctx: BlockContext, row: Task, flowKind?: string): Promise<void> {
  const sessionId = row.run?.sessionId;
  if (sessionId === undefined) return;
  const wakes = ctx.requestHost?.wakes;
  try {
    await wakes?.owe({ entry: STEER_TURN_ENTRY, dueAt: Date.now() + STEER_TURN_DUE_MS, sessionId });
  } catch (error) {
    console.warn(`[workforce] the wake for task "${row.id}"'s steer turn couldn't be written; its start runs now only`, {
      error: (error as Error).message
    });
  }
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: STEER_TURN_ENTRY,
      ...(flowKind !== undefined ? { flowKind } : {}),
      session: { id: sessionId },
      payload: {},
      from: "workforce-steer-turn"
    });
  } catch {
    // Not definitive: the wake starts it.
  }
}

/** What a line steering the session's task answers: the task it steered. */
const steeredSchema = z.object({ steered: z.string() });

/** The user's id, from the request's server-set identity. */
function userOf(ctx: BlockContext): string | undefined {
  return (ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId;
}

/** Thrown when the line can't steer: the task finished first, or took its last steer. The request fails, naming why. */
export class SteerRefused extends Error {
  readonly code = "steer-refused";
}

/**
 * Write the line as a steer on the session's open task, from the user, keyed
 * by this request so a replay adds nothing, and start the turn it is owed when
 * the task runs nothing now. The router read the task, and this reads it
 * again: a route takes only the router's input.
 */
const steerSessionTask = handler({
  name: "worker-steer-session-task",
  inputSchema: z.object({ message: z.string() }).passthrough(),
  outputSchema: steeredSchema,
  resources: { ...conversationLedgerResources },
  execute: async (input, ctx) => {
    const open = await sessionOpenTask(ctx as never);
    if (open === undefined) throw new SteerRefused("The task finished before your message reached it. Send it again to talk about it.");
    const by = userOf(ctx as never);
    const outcome = await open.ledger.steer!(open.row.id, {
      message: input.message,
      from: "user",
      ...(by !== undefined ? { by } : {}),
      key: `line:${ctx.request.identity.id}`
    });
    if (outcome.outcome === "declined") {
      throw new SteerRefused(
        outcome.reason === "steer-limit"
          ? "This task has taken as many messages as it can. Cancel it and file it again, or file a follow-up once it ends."
          : "The task finished before your message reached it. Send it again to talk about it."
      );
    }
    const row = open.ledger.get(open.row.id);
    // In this session already: the turn runs on this flow.
    if (row?.waitingOn === "steer") await startOwedSteerTurn(ctx as never, row);
    return { steered: open.row.id };
  }
});

/**
 * A worker's door in a session: a steer while the session's task is open,
 * else `turn`, the worker's ordinary reply.
 *
 * @param turn The worker's turn for one line: what the door ran before.
 */
export function steerOrTalk<TInputSchema extends ZodTypeAny>(
  turn: BlockDefinition<TInputSchema, ZodTypeAny>
): BlockDefinition<TInputSchema, ZodTypeAny> {
  const steer = steerSessionTask as unknown as BlockDefinition<TInputSchema, ZodTypeAny>;
  // The two routes answer different shapes (the turn's reply, or the task it
  // steered), so the router's output is left open rather than one of them.
  return router({
    name: "worker-steer-or-talk",
    inputSchema: turn.inputSchema,
    routes: [turn, steer],
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx) => ((await sessionOpenTask(ctx)) === undefined ? turn : steer)
  });
}

/** What the steer turn's take hands on. Plain data: it is recorded. */
type Taken = { readonly steers: ShownSteer[]; readonly taskId: string } | { readonly skip: true };

const SKIP: Taken = { skip: true };

const skipped = (value: unknown): boolean => (value as { skip?: unknown } | undefined)?.skip === true;

/** The steer turn's options: the worker's turn, or a block that takes the task itself. Exactly one. */
export type SteerTurnEntryOptions = {
  /** Names the entry's blocks. */
  readonly name: string;
} & (
  | { readonly turn: BlockDefinition<any, any>; readonly block?: never }
  | { readonly block: BlockDefinition<any, any>; readonly turn?: never }
);

/**
 * The internal entry for the turn a late steer is owed (D2). Spread it as
 * `internal: { actions: { [STEER_TURN_ENTRY]: steerTurnEntry({ ... }) } }`
 * on every flow whose `work` entry is a `workerTaskEntry`, with the same
 * `turn` or `block`.
 *
 * A `turn` is handed the steers as its message; a `block` is handed the task
 * as the board packs it, with the claim. A start that finds nothing to do
 * runs nothing. The wake is cleared once the task no longer waits on a steer.
 * `concurrency` defaults to the session's notices, so this runs once the
 * request working the task has ended.
 */
export function steerTurnEntry(options: SteerTurnEntryOptions & { readonly concurrency?: ConcurrencyConfig }) {
  const { name } = options;
  const take = handler({
    name: `${name}-take-steers`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx): Promise<Taken> => {
      // Admitted, the claim is stamped and names the row; otherwise there is nothing to run.
      const running = await runningTaskOf(sessionLedger, ctx as never);
      if (running === undefined) return SKIP;
      const steers = await takeRunningSteers(running, `turn:${ctx.request.identity.id}`);
      if (steers.length === 0) return SKIP;
      return { steers, taskId: running.row.id };
    }
  });

  const runInput = handler({
    name: `${name}-input`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    resources: { ...conversationLedgerResources },
    execute: async (value, ctx) => {
      const taken = value as Exclude<Taken, { skip: true }>;
      if (options.turn !== undefined) return { message: renderSteers(taken.steers, STEERED_AFTER_ANSWER) };
      const running = await runningTaskOf(sessionLedger, ctx as never);
      if (running === undefined) throw new Error(`"${name}" lost the claim it was admitted with before its block ran.`);
      const { claim, ledger } = running;
      const row = ledger.get(taken.taskId) ?? running.row;
      return {
        ...(await packWorkerInput(row, ledger)),
        claim: {
          collectionId: claim.collectionId,
          ...(claim.partition === undefined ? {} : { partition: claim.partition }),
          ...(claim.incarnationId === undefined ? {} : { incarnationId: claim.incarnationId })
        }
      };
    }
  });
  const run = sequencer({ name: `${name}-run`, inputSchema: z.unknown() })
    .step(runInput as BlockDefinition<any, any>)
    .step((options.turn ?? options.block) as BlockDefinition<any, any>);

  // Cleared after the check, and only once the task no longer waits on a
  // steer: a crash, or a turn that never ran, leaves the wake to start it.
  const settleWake = handler({
    name: `${name}-settle-wake`,
    inputSchema: z.unknown(),
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx) => {
      await afterTaskCheck(ctx as never, async () => {
        const ledger = await sessionLedger(ctx as never);
        const sessionId = ctx.session.identity.id;
        const row = ledger?.list({ status: "in_progress" }).find((task) => task.run?.sessionId === sessionId);
        if (row?.waitingOn === "steer") return;
        const wakes = ctx.requestHost?.wakes;
        const read = await wakes?.read(STEER_TURN_ENTRY);
        if (wakes !== undefined && read !== undefined) await wakes.settle(STEER_TURN_ENTRY, read, null);
      });
    }
  });

  return {
    inputSchema: z.object({}).passthrough(),
    block: sequencer({ name, inputSchema: z.unknown() })
      .tap(admitOwnTask(`${name}-admission`, true))
      .step(take as BlockDefinition<any, any>)
      .stepIf((taken: unknown) => !skipped(taken), run as BlockDefinition<any, any>)
      .tapIf((answer: unknown) => !skipped(answer), noteTaskAnswer)
      .tap(settleWake),
    concurrency: options.concurrency ?? AFTER_REPLY_CONCURRENCY
  };
}
