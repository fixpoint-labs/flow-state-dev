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
 *   call, server-side. A task session files too: its pieces, which its task
 *   then waits on (`./split`).
 * - **The limits** (FIX-1802 S5). A filing past the chain's depth or its
 *   breadth is refused in the ref the resolver returns (`./chain`), as the
 *   task substrate refuses a full board: `total_task_cap_exceeded`.
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
 *   notices its rows still owe into the conversation (`./task-notice`), and
 *   a run of the board into each parked split row's task session, which
 *   settles it when its pieces are done (`./split`).
 */
import {
  buildTaskToolsList,
  taskToolActions,
  type TaskCollectionResolver,
  type AssigneeRoster,
  type AssigneeRosterSource
} from "@flow-state-dev/orchestration";
import { currentWorkerClaim, taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  TaskCapExceededError,
  isClaimable,
  isTerminalStatus,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorkerInput,
  type TaskWriteOutcome
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
  TASK_CHAIN_STATE_KEY,
  TASK_FLOW_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY
} from "../workers/keys";
import { RUN_BOARD_ENTRY } from "./board-entries";
import {
  DEFAULT_TASK_CHAIN_LIMIT,
  MAX_TASK_DEPTH,
  chainEntryKey,
  deleteChain,
  chainOfFiling,
  markAddedInChain,
  reserveInChain,
  taskChainOf,
  taskChainResources
} from "./chain";
import { filingSessionIdOf } from "./filing-session";
import {
  CONVERSATION_LEDGER_ID,
  callerMetadata,
  conversationLedger,
  conversationLedgerAt,
  conversationLedgerResources
} from "./ledger";
import { sendOwedNotices } from "./notice-delivery";
import { cascadeIfSplit, replaySplits, settleIfOwedLater } from "./split";
import { owedNotices } from "./task-notice";

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
  /** The most tasks under one top task, read on every filing. Omitted, {@link DEFAULT_TASK_CHAIN_LIMIT}. */
  chainLimit?: () => number | undefined;
}

/** A new task's id, minted before its add so its place in the chain is reserved first. */
function newTaskId(): string {
  return `task_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
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
   * delegates takes a task, read from its list as it stands. Server-side
   * only: the list is server-written state, never input.
   */
  const files = async (ctx: BlockContext): Promise<boolean> => (await options.delegates(ctx)).available.size > 0;

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
    // that filed it and the flow that session runs on, its own flow, and its
    // place in the chain (the board its task is on, and the chain's top),
    // each a readonly field the worker flow's create check confirms; all
    // from server-written data.
    state: async (task, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      const flow = (await options.delegates(ctx)).available.get(task.assignee);
      return {
        [WORKER_ID_STATE_KEY]: task.assignee,
        [FILING_SESSION_STATE_KEY]: partition,
        [FILING_FLOW_STATE_KEY]: options.flowKind,
        [TASK_ID_STATE_KEY]: task.taskId,
        [TASK_CHAIN_STATE_KEY]: chainOfFiling(ctx, partition, task.taskId).birth,
        ...(flow !== undefined ? { [TASK_FLOW_STATE_KEY]: flow } : {})
      };
    }
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
   * own board, guarded. A filing past the chain's limits is refused before
   * anything is written. A filing or an assign that leaves a row startable
   * wakes the board, and a retried one wakes it again. No caller write
   * reaches a notice marker or a split marker. A write that ends a split
   * task cancels its open pieces, down the chain.
   */
  const guarded = (ctx: BlockContext, ref: TaskCollectionRef, partition: string): TaskCollectionRef => {
    const addTask: TaskCollectionRef["addTask"] = async (init) => {
      const id = init.id ?? newTaskId();
      const chain = chainOfFiling(ctx, partition, id);
      if (chain.depth > MAX_TASK_DEPTH) {
        // The board one past the deepest takes no task.
        throw new TaskCapExceededError({ cap: "total", limit: MAX_TASK_DEPTH, attempted: chain.depth, collectionId: ref.collectionId });
      }
      const entry = chainEntryKey(partition, id);
      if (chain.top !== undefined) {
        await reserveInChain(ctx, {
          top: chain.top,
          entry,
          limit: options.chainLimit?.() ?? DEFAULT_TASK_CHAIN_LIMIT,
          now: ref.now(),
          collectionId: ref.collectionId
        });
      }
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
        id,
        maxAttempts: init.maxAttempts ?? TASK_ATTEMPTS,
        ...(assignee !== undefined ? { assignee } : {}),
        ...(metadata !== undefined ? { metadata } : {})
      });
      if (chain.top !== undefined) await markAddedInChain(ctx, chain.top, [entry]);
      if (assignee !== undefined) await wake(ctx);
      return added;
    };
    /**
     * The options a write on this board presents: a claim the running
     * session holds on a row of another board (a task session's own task)
     * asks nothing of this one, so it is left off.
     */
    const ownClaim = (guards: unknown): unknown => {
      const claim = (guards as { claim?: { partition?: string } } | undefined)?.claim;
      return claim !== undefined && claim.partition !== partition ? { ...(guards as object), claim: undefined } : guards;
    };
    /** A write that may end a split task: cancel its open pieces once it lands. */
    const ending =
      (write: (id: string, ...rest: any[]) => Promise<TaskWriteOutcome>) =>
      async (id: string, ...rest: any[]): Promise<TaskWriteOutcome> => {
        const before = ref.get(id);
        const last = rest.length - 1;
        const args = last >= 0 && rest[last] !== null && typeof rest[last] === "object" ? [...rest.slice(0, last), ownClaim(rest[last])] : rest;
        const outcome = await write(id, ...args);
        await cascadeIfSplit(ctx, before, outcome);
        // A top task ended here takes its chain's count with it.
        const after = ref.get(id);
        if (taskChainOf(ctx) === undefined && after !== undefined && isTerminalStatus(after.status) && before?.status !== after.status) {
          await deleteChain(ctx, { partition, taskId: id });
        }
        return outcome;
      };
    return {
      ...ref,
      addTask,
      complete: ending(ref.complete.bind(ref)) as TaskCollectionRef["complete"],
      fail: ending(ref.fail.bind(ref)) as TaskCollectionRef["fail"],
      cancel: ending(ref.cancel.bind(ref)) as TaskCollectionRef["cancel"],
      block: ending(ref.block.bind(ref)) as TaskCollectionRef["block"],
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
    const partition = await filingSessionIdOf(ctx.session);
    const ref = await conversationLedgerAt(ctx, partition);
    if (ref === undefined) return undefined;
    // The outbox, on every touch, a read included. A crash after an ending's
    // write and before its notice's send (BR-26a), or a wake lost after an add
    // or an assign (BR-10a), leaves the debt only on the row, and nothing
    // sweeps for it: this touch is what pays it. Don't narrow it to writes,
    // or to a session that files now: rows filed before it lost its last
    // task-taking delegate still run and are heard (FIX-1802 BR-5).
    if (hasStartable(ref)) await wake(ctx);
    await replayNotices(ctx, ref.list());
    // And the settles owed down the chain: each parked split row's session
    // settles its task once its pieces are done, this one's included, behind
    // any turn it is running (FIX-1802 BR-17).
    await replaySplits(ctx, ref.list());
    await settleIfOwedLater(ctx);
    // No board to act on while the session doesn't file: none of its
    // delegates takes a task now, so an action answers `no_delegation_board`.
    if (!(await files(ctx))) return undefined;
    return guarded(ctx, ref, partition);
  };

  /**
   * After a run: send what the rows owe, including what this run's own
   * refusals and settled dead runs owe; run the board of each parked split
   * row's session, down the chain; mark each of this board's pieces added in
   * its chain (a crash between an add and its mark leaves it reserved, and
   * the lease must never drop a piece that landed); and, in a task session
   * whose pieces are all done, settle its task, behind any turn it is running.
   */
  const afterRun = handler({
    name: "conversation-board-after-run",
    inputSchema: z.unknown(),
    outputSchema: z.object({ replayed: z.number() }),
    resources: { ...conversationLedgerResources, ...taskChainResources },
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const partition = await filingSessionIdOf(ctx.session);
      const ref = await conversationLedgerAt(ctx, partition);
      if (ref === undefined) return { replayed: 0 };
      const rows = ref.list();
      const replayed = await replayNotices(ctx, rows);
      await replaySplits(ctx, rows);
      const top = taskChainOf(ctx)?.top;
      if (top !== undefined) await markAddedInChain(ctx, top, rows.map((row) => chainEntryKey(partition, row.id)));
      await settleIfOwedLater(ctx);
      return { replayed };
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
  const eight = buildTaskToolsList(resolver, roster);
  const tools = defineCapability({
    name: "taskTools",
    resources: { ...conversationLedgerResources, ...taskChainResources },
    presets: {
      tools: { controlTools: async (ctx) => ((await files(ctx as never)) ? eight : []) },
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
    /** The ledger and the chain records, for the flow's `resources`. */
    resources: { ...conversationLedgerResources, ...taskChainResources }
  };
}

export type ConversationBoard = ReturnType<typeof defineConversationBoard>;
