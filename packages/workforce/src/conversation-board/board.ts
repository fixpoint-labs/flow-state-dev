/**
 * A session's task board (FIX-1794 S3 to S5, FIX-1802 S1 and S2): where a
 * session files tasks for its delegates, who takes each one, and how a filing
 * starts it.
 *
 * - **The board.** One `taskBoard` over the conversation ledger
 *   (`./ledger`), run only in its own session, as its owner. Its one
 *   assignee, the default one, hands every row to the `work` entry on the flow
 *   its delegate runs on, in a task session: a new child of the filing
 *   session, keyed by the task and the worker, named for both, for the filing
 *   session (`filingSessionId`) and for the flow it runs on (`filingFlow`). A
 *   second attempt re-enters it; a reassign opens another. The hand-over
 *   re-runs the delegate check, so a delegate fired since the filing doesn't
 *   run.
 * - **The grant** (FIX-1802 D1). A session files when its delegate list holds
 *   one that takes a task now: the same list the roster reads, read on every
 *   call, server-side. A task session files nothing yet (FIX-1802 P2 lifts
 *   that with the split).
 * - **The tools and the actions.** Orchestration's eight task tools, on the
 *   model's turn and as public actions, over one resolver and one roster. The
 *   tools are one capability whose eight are on a turn only while the session
 *   files, read per call. The resolver is the running session's own board,
 *   and none while it doesn't file, so an action answers
 *   `no_delegation_board`. The roster is the session's delegates that take a
 *   task, read on every call.
 * - **The start.** A filing or an assign dispatches a run of the board into
 *   the conversation as a request of its own, and returns without waiting for
 *   it. The start it owes is the row's own state, pending and assigned
 *   (`./ledger`), so a refused or lost wake strands nothing: any later action
 *   on the board starts every row in that state.
 * - **The outbox.** Any action on the board, and every run of it, replays the
 *   notices its rows still owe into the conversation (orchestration's notice
 *   module).
 */
import {
  resumeOwedAsks,
  taskToolsForTurn,
  taskToolActions,
  type TaskCollectionResolver,
  type AssigneeRoster,
  type AssigneeRosterSource
} from "@flow-state-dev/orchestration";
import { currentWorkerClaim, taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  isClaimable,
  owedNotices,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorkerInput
} from "@flow-state-dev/orchestration/tasks";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import type { BlockContext, BlockDefinition, DispatchAddress } from "@flow-state-dev/core/types";
import { z } from "zod";
import { WORKER_TASK_ENTRY } from "../worker-task-entry";
import type { TaskDelegates } from "../delegates/worker-delegates";
import {
  FILING_FLOW_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY
} from "../workers/keys";
import { filingSessionIdOf } from "./filing-session";
import {
  CONVERSATION_LEDGER_ID,
  callerMetadata,
  conversationLedger,
  conversationLedgerResources,
  ownConversationLedger
} from "./ledger";
import { sendOwedNotices } from "./notice-delivery";

/** The internal entry a filing dispatches to run its conversation's board. */
export const RUN_BOARD_ENTRY = "runTaskBoard";

/**
 * How many attempts a filed task gets: a failure with one left runs the task
 * again in the same session, with no coordinator turn, and the second failure
 * is the one the conversation hears.
 */
export const TASK_ATTEMPTS = 2;

/** What a session's board is built from. */
export interface ConversationBoardOptions {
  /**
   * The running session's delegates, read now: the one check FIX-1791's
   * delegates pass, for a task. Read at filing and again at hand-over, and
   * for the grant on every call.
   */
  delegates: (ctx: BlockContext) => Promise<TaskDelegates>;
  /**
   * The kind of the flow the board's sessions run on: where each task it
   * hands over sends its notice back, as the task session's `filingFlow`.
   */
  flowKind: string;
}

/** Whether the running session is a task session: one a conversation's board opened to work a task. */
export function isTaskSession(ctx: { readonly session: { readonly state: unknown } }): boolean {
  return typeof (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY] === "string";
}

/** A roster over the session's task-taking delegates, naming why each other one can't take a task. */
function rosterOf(delegates: TaskDelegates): AssigneeRoster {
  return {
    has: (name) => delegates.available.has(name),
    describe: () => {
      const available = [...delegates.available.keys()];
      const listed = available.length > 0 ? available.join(", ") : "(no delegate in this conversation takes a task)";
      if (delegates.unavailable.size === 0) return listed;
      const why = [...delegates.unavailable].map(([worker, reason]) => `${worker}: ${reason}`).join("; ");
      return `${listed}. Not taking tasks now: ${why}`;
    }
  };
}

/**
 * The task session's key: one per task and worker, so a retry re-enters the
 * session it ran in and a reassign opens a new one, beside the old one's
 * history. A child of the conversation, so two conversations filing one task
 * id for one worker get two sessions.
 */
function taskSessionKey(taskId: string, worker: string): string {
  return `task:${JSON.stringify([taskId, worker])}`;
}

/** Claims only rows that name a delegate: an unassigned row waits on the board until it is assigned. */
const assignedOnly: TaskDispatcher = {
  claim: (collection, workerId) => collection.claim(workerId, { eligibility: (task) => task.assignee !== undefined })
};

/**
 * Whether a row this board can start is waiting: assigned, and claimable now
 * (a dead run's row included). Such a row is owed a run of the board; this is
 * the whole of a start's debt (`./ledger`). With `id`, only that row.
 */
function hasStartable(collection: TaskCollectionRef, id?: string): boolean {
  const now = collection.now();
  const lookup = (taskId: string): Task | undefined => collection.get(taskId);
  return collection
    .list({ status: ["pending", "in_progress"] })
    .some((task) => (id === undefined || task.id === id) && task.assignee !== undefined && isClaimable(task, lookup, now));
}

/**
 * Dispatch a run of the running conversation's board into the conversation,
 * as a request of its own. Never waits for it, and never fails the caller: a
 * refused or thrown dispatch leaves the row pending, which is its start debt,
 * for the next touch.
 */
async function wake(ctx: BlockContext): Promise<void> {
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: RUN_BOARD_ENTRY,
      session: { id: ctx.session.identity.id },
      payload: {},
      from: "conversation-board-wake"
    });
  } catch {
    // The row stays pending and assigned; the next filing or action retries it.
  }
}

/**
 * Send each notice the conversation's rows still owe into the conversation
 * itself, as requests of their own. Only rows that still carry a notice
 * marker are sent; the receiving entry dedupes, so a notice replayed while
 * its first send is in flight is acted on once.
 */
export async function replayNotices(ctx: BlockContext, rows: readonly Task[]): Promise<number> {
  const owing = rows.filter((row) => owedNotices(row, CONVERSATION_LEDGER_ID).length > 0);
  let sent = 0;
  for (const row of owing) {
    sent += await sendOwedNotices(ctx, row, { session: { id: ctx.session.identity.id }, from: "conversation-board-replay" });
  }
  return sent;
}

/**
 * Build a conversation's task board and everything a flow carrying it
 * declares: the drain behind the run entry, the tools for the model's turn,
 * the actions, and the ledger.
 */
export function defineConversationBoard(options: ConversationBoardOptions) {
  const roster: AssigneeRosterSource = async (ctx) => rosterOf(await options.delegates(ctx));

  /**
   * Whether the running session files now (FIX-1802 D1): one of its
   * delegates takes a task, read from its list as it stands, and it isn't a
   * task session. Server-side only: the list is server-written state, never
   * input.
   */
  const files = async (ctx: BlockContext): Promise<boolean> => {
    if (isTaskSession(ctx)) return false;
    return (await options.delegates(ctx)).available.size > 0;
  };

  // The hand-over: every row to `work` on its delegate's flow, in a task
  // session keyed by the task and the worker. Built as an address rather than
  // through `dispatcher()`, whose per-task target is held to a "per-task"
  // session, keyed by the task alone: a reassign would then re-enter a session
  // named for the first worker, and run as it. Keying by the worker too keeps
  // one session to one task and one worker, which is the rule's own reason.
  const address: DispatchAddress = {
    type: "task",
    action: WORKER_TASK_ENTRY,
    session: {
      // The board's hand-off computes the key while the claim it took is
      // still on its worker body's state: the assignee is the one the row was
      // claimed with, which the board freezes while an attempt holds it.
      key: (payload: TaskWorkerInput, ctx: BlockContext) => {
        const claim = (ctx.sequencer?.state as { currentClaim?: { assignee?: string } } | undefined)?.currentClaim;
        const worker = claim?.assignee ?? currentWorkerClaim()?.assignee;
        if (worker === undefined) {
          throw new Error(`Task "${payload.taskId}" names no delegate, so it has no session to run in.`);
        }
        return taskSessionKey(payload.taskId, worker);
      }
    },
    // Re-run the delegate check at hand-over: a delegate fired, removed or
    // moved to a flow that takes no tasks since the filing is refused here,
    // with the claim held, so the task fails and the conversation hears it.
    flowKind: async (task, ctx) => {
      const delegates = await options.delegates(ctx);
      const flow = delegates.available.get(task.assignee);
      if (flow !== undefined) return flow;
      const why = delegates.unavailable.get(task.assignee) ?? "it isn't one of this conversation's delegates";
      throw new Error(`Task "${task.taskId}" wasn't handed to "${task.assignee}": ${why}.`);
    },
    // The task session is born naming its worker, the task, the session
    // that filed it and the flow that session runs on, each a readonly field
    // the worker flow's create check confirms; all from server-written data.
    state: async (task, ctx) => ({
      [WORKER_ID_STATE_KEY]: task.assignee,
      [FILING_SESSION_STATE_KEY]: await filingSessionIdOf(ctx.session),
      [FILING_FLOW_STATE_KEY]: options.flowKind,
      [TASK_ID_STATE_KEY]: task.taskId
    })
  };
  const handOffToDelegate = markDispatcher(
    handler({
      name: "conversation-board-hand-off",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("The conversation board's hand-off runs through the board, never on its own.");
      }
    }),
    address
  );

  const board = taskBoard({
    name: "conversation-tasks",
    boardId: CONVERSATION_LEDGER_ID,
    collection: conversationLedger,
    workers: {},
    defaultWorker: handOffToDelegate as never,
    dispatcher: assignedOnly,
    // Exit once nothing this run can start is waiting. An unassigned row
    // waits on the board for `assignTask`, so a run must not wait on it.
    onIdle: "wait",
    shouldExit: (collection) => !hasStartable(collection)
  });

  /**
   * The ledger the tools and actions write through: the running session's
   * own board, guarded. A filing or an assign that leaves a row startable
   * wakes the board, and a retried one wakes it again. No caller write
   * reaches a notice marker.
   */
  const guarded = (ctx: BlockContext, ref: TaskCollectionRef): TaskCollectionRef => {
    const addTask: TaskCollectionRef["addTask"] = async (init) => {
      let assignee = init.assignee;
      if (assignee === undefined) {
        // An unassigned task goes to the conversation's only delegate; with
        // none or several it waits on the board until it is assigned.
        const delegates = await options.delegates(ctx);
        if (delegates.available.size === 1) assignee = [...delegates.available.keys()][0]!;
      }
      const metadata = callerMetadata(init.metadata);
      const added = await ref.addTask({
        ...init,
        maxAttempts: init.maxAttempts ?? TASK_ATTEMPTS,
        ...(assignee !== undefined ? { assignee } : {}),
        ...(metadata !== undefined ? { metadata } : {})
      });
      if (assignee !== undefined) await wake(ctx);
      return added;
    };
    return {
      ...ref,
      addTask,
      async addTasks(inits) {
        const added: Task[] = [];
        for (const init of inits) added.push(await addTask(init));
        return added;
      },
      async setAssignee(id, assignee) {
        const outcome = await ref.setAssignee(id, assignee);
        // `unchanged` too: an assign retried after a lost wake starts the row.
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await wake(ctx);
        return outcome;
      },
      async patchMetadata(id, patch) {
        return ref.patchMetadata(id, callerMetadata(patch) ?? {});
      }
    };
  };

  /** Every action on the board, and the model's every tool call, reach it here. */
  const resolver: TaskCollectionResolver = async (ctx) => {
    // A task session keeps no board until FIX-1802 P2 lets it split.
    if (isTaskSession(ctx)) return undefined;
    const ref = await ownConversationLedger(ctx);
    if (ref === undefined) return undefined;
    // The outbox, on every touch, a read included. A crash after an ending's
    // write and before its notice's send (BR-26a), or a wake lost after an add
    // or an assign (BR-10a), leaves the debt only on the row, and nothing
    // sweeps for it: this touch is what pays it. Don't narrow it to writes,
    // or to a session that files now: rows filed before it lost its last
    // task-taking delegate still run and are heard (FIX-1802 BR-5).
    if (hasStartable(ref)) await wake(ctx);
    await replayNotices(ctx, ref.list());
    // No board to act on while the session doesn't file: none of its
    // delegates takes a task now, so an action answers `no_delegation_board`.
    if (!(await files(ctx))) return undefined;
    return guarded(ctx, ref);
  };

  /**
   * After a run: send what the rows owe, including what this run's own
   * refusals and settled dead runs owe, and resume each turn an asked row's
   * ending still owes (`resumeOwedAsks`): a run of the board is a touch, and
   * not a turn.
   */
  const afterRun = handler({
    name: "conversation-board-after-run",
    inputSchema: z.unknown(),
    outputSchema: z.object({ replayed: z.number() }),
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx) => {
      const ref = await ownConversationLedger(ctx as never);
      if (ref === undefined) return { replayed: 0 };
      // One of two resume touches, with the notice entry's (`./task-settled`),
      // which is the fast path and keeps the notice owed until the resume
      // lands. Neither has to win: the gate admits one answer and refuses the
      // other `already-resolved`, and either outcome clears `resumeOwed`.
      await resumeOwedAsks(ctx as never, ref);
      return { replayed: await replayNotices(ctx as never, ref.list()) };
    }
  });

  /** One run of the board, in its own conversation, as its owner: claim, hand over, settle up. */
  const runBoard: BlockDefinition<any, any> = sequencer({ name: "conversation-run-board", inputSchema: z.unknown() })
    .step(board.drain)
    .tap(afterRun);

  /**
   * The eight task tools for the model's turn: one capability instance, whose
   * eight are on a turn only while the session files, read before each model
   * call. Orchestration's own tools over this board's resolver and roster;
   * `controlTools`, as Orchestration's capability carries them, so a worker's
   * `tools:` line doesn't fence them out.
   */
  // Chosen per turn: `addTask` waits for its answer only where the host can
  // hold an ask (FIX-1816).
  const eight = taskToolsForTurn(resolver, roster);
  const tools = defineCapability({
    name: "taskTools",
    resources: { ...conversationLedgerResources },
    presets: {
      tools: { controlTools: async (ctx) => ((await files(ctx as never)) ? eight(ctx as never) : []) },
      default: ["tools"]
    }
  });

  return {
    board,
    roster,
    resolver,
    runBoard,
    files,
    tools,
    /** The eight task tools as public actions, `<tool>_tasks`. */
    actions: taskToolActions(CONVERSATION_LEDGER_ID, resolver, roster),
    /** The ledger, for the flow's `resources`. */
    resources: conversationLedgerResources
  };
}

export type ConversationBoard = ReturnType<typeof defineConversationBoard>;
