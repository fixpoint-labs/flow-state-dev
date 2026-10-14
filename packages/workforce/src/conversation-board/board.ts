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
 * - **The tools and the actions.** Orchestration's task tools, `dispatchTask` among them, on the
 *   model's turn and as public actions, over one resolver and one roster. The
 *   tools are one capability whose tools are on a turn only while the session
 *   files, read per call. The resolver is the running session's own board,
 *   and none while it doesn't file, so an action answers
 *   `no_delegation_board`. The roster is the session's delegates that take a
 *   task, read on every call.
 * - **The start.** A filing or an assign dispatches a run of the board into
 *   the conversation as a request of its own, and returns without waiting for
 *   it. The start it owes is the row's own state, pending and assigned
 *   (`./ledger`), so a refused or lost wake strands nothing: any later action
 *   on the board starts every row in that state.
 * - **Posts** (FIX-1872). A coordinator files a row per delegate it hands a
 *   post to, through {@link ConversationBoard.filePost}: the post in the
 *   row's server-written payload (`../coordinator/delegated-post`). The
 *   hand-over sends such a row to the delegated-post entry on the delegate's
 *   flow, in the session written on the row, never a task session, after the
 *   delegate check for a post. Its assignee can't be changed.
 * - **The outbox.** Any action on the board, and every run of it, replays the
 *   notices its rows still owe into the conversation (orchestration's notice
 *   module), and a run of the board into each parked split row's task
 *   session, which settles it when its pieces are done (`./split`).
 */
import {
  resumeOwedWaits,
  taskToolsForTurn,
  taskToolActions,
  type TaskCollectionResolver,
  type AssigneeRoster,
  type AssigneeRosterSource,
  type DispatchPostForm
} from "@flow-state-dev/orchestration";
import { currentWorkerClaim, taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  TaskCapExceededError,
  isClaimable,
  isTerminalStatus,
  owedNotices,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorkerInput,
  type TaskWriteOutcome
} from "@flow-state-dev/orchestration/tasks";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import type { BlockContext, BlockDefinition, DispatchAddress, TaskTargetQuery } from "@flow-state-dev/core/types";
import { z } from "zod";
import { DELEGATED_POST_ENTRY, WORKER_TASK_ENTRY } from "../worker-task-entry";
import { isPostRow, postRowOf } from "../coordinator/delegated-post";
import type { TaskDelegates } from "../delegates/worker-delegates";
import {
  FILING_FLOW_STATE_KEY,
  FILING_PROJECT_STATE_KEY,
  FILING_WORKSTREAM_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  TASK_CHAIN_STATE_KEY,
  TASK_FLOW_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY
} from "../workers/keys";
import { PIECE_OF, RETRY_OF, RUN_BOARD_ENTRY } from "./board-entries";
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
import type { ProjectAddressRef } from "../projects/workstream-ref";
import { filingProjectAddressOf, filingProjectOf, filingSessionIdOf, filingWorkstreamOf } from "./filing-session";
import {
  CONVERSATION_LEDGER_ID,
  callerMetadata,
  conversationLedger,
  conversationLedgerAt,
  conversationLedgerResources
} from "./ledger";
import { POST_SETTLED_ENTRY, sendOwedNotices } from "./notice-delivery";
import { cascadeIfSplit, pieceOwnerOf, replaySplits, retryingPiece, settleIfOwedLater } from "./split";

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
   * The worker flow the board's sessions run on: where each task it
   * hands over sends its notice back, as the task session's `filingFlow`.
   */
  flowKind: string;
  /** The most tasks under one top task, read on every filing. Omitted, {@link DEFAULT_TASK_CHAIN_LIMIT}. */
  chainLimit?: () => number | undefined;
  /**
   * The flow a delegate takes a post on, by the delegate check for a post, read
   * at hand-over; throws with why when it takes none now. Omitted, the board
   * hands over no post row.
   */
  postFlow?: (ctx: BlockContext, worker: string) => Promise<string>;
  /**
   * `dispatchTask`'s post form (`post: true`), for a session that routes
   * posts. On a turn routing one, `dispatchTask` is offered even while the
   * session files no task, with its post form.
   */
  posts?: DispatchPostForm;
}

/** A new task's id, minted before its add so its place in the chain is reserved first. */
function newTaskId(): string {
  return `task_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

/** Write the session's project over a named `project`, so a guess isn't refused `other-project`. */
function ownProjectIn(input: unknown, own: ProjectAddressRef | undefined): unknown {
  if (own === undefined || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  if ((input as { project?: unknown }).project == null) return input;
  return { ...input, project: own };
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
    },
    // The same default the guarded `addTask` gives an unassigned row: the
    // conversation's only task-taking delegate, or none.
    soleAssignee: () => (delegates.available.size === 1 ? [...delegates.available.keys()][0] : undefined)
  };
}

/**
 * The task session's key: one per task and worker, so a retry re-enters the
 * session it ran in and a reassign opens a new one, beside the old one's
 * history. A follow-up is keyed by the task it follows (its root), so it runs
 * in that task's session. A child of the conversation, so two conversations filing one task
 * id for one worker get two sessions.
 */
function taskSessionKey(taskId: string, worker: string): string {
  return `task:${JSON.stringify([taskId, worker])}`;
}

/**
 * The claim the board's dispatch holds while it addresses a task: on its
 * worker body's state, or in the claimed worker's async scope. Server-derived:
 * minted from the row the board just claimed.
 */
function claimOf(ctx: BlockContext): { assignee?: string; followUpOf?: string } | undefined {
  const onState = (ctx.sequencer?.state as { currentClaim?: { assignee?: string; followUpOf?: string } } | undefined)
    ?.currentClaim;
  return onState ?? currentWorkerClaim();
}

/**
 * The board's one test for "may start" (FIX-1875 S6): the row names a
 * delegate, and it isn't recorded-but-not-dispatched (`undispatched`). Every
 * start path reads it: the claim, the drain's exit, and the wakes after a
 * filing, an assign, an answer and a touch. A path that tests the assignee
 * alone starts a recorded row. Claimability (status, deps, lease) is the
 * substrate's, read beside it; the substrate's admission refuses the mark too,
 * so another claimer of the same collection never starts a recorded row. This
 * test still reads it because the filing's wake reads no claimability.
 */
export function isStartable(task: Pick<Task, "assignee" | "undispatched">): boolean {
  return task.assignee !== undefined && task.undispatched !== true;
}

/** Claims only rows that may start: an unassigned or recorded row waits on the board. */
const startableOnly: TaskDispatcher = {
  claim: (collection, workerId) => collection.claim(workerId, { eligibility: isStartable })
};

/**
 * Whether a row this board can start is waiting: startable ({@link isStartable})
 * and claimable now (a dead run's row included). Such a row is owed a run of
 * the board; this is the whole of a start's debt (`./ledger`). With `id`, only
 * that row.
 */
function hasStartable(collection: TaskCollectionRef, id?: string): boolean {
  const now = collection.now();
  const lookup = (taskId: string): Task | undefined => collection.get(taskId);
  return collection
    .list({ status: ["pending", "in_progress"] })
    .some((task) => (id === undefined || task.id === id) && isStartable(task) && isClaimable(task, lookup, now));
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
  /** The post on the row being handed over, when it is a post row. */
  const postOf = (task: TaskTargetQuery) => postRowOf(task.input as TaskWorkerInput);
  const address: DispatchAddress = {
    type: "task",
    // A post row goes to the delegate's post entry; every other row to `work`.
    action: {
      among: [WORKER_TASK_ENTRY, DELEGATED_POST_ENTRY],
      by: (task) => (postOf(task) !== undefined ? DELEGATED_POST_ENTRY : WORKER_TASK_ENTRY)
    },
    session: {
      // The board's dispatch computes it while the claim it took is still on
      // its worker body's state: the assignee is the one the row was claimed
      // with, which the board freezes while an attempt holds it.
      by: (task, ctx) => {
        // A post row runs in the session written on it when it was filed:
        // the delegate's own session for this conversation, or the one its
        // workstream named. Never a session keyed by the task.
        const post = postOf(task);
        if (post !== undefined) return post.session;
        const claim = claimOf(ctx);
        const worker = claim?.assignee;
        if (worker === undefined) {
          throw new Error(`Task "${task.taskId}" names no delegate, so it has no session to run in.`);
        }
        // A follow-up runs in the session of the task it follows (FIX-1817):
        // keyed by that root task, from the claim, never from input.
        return { key: taskSessionKey(claim?.followUpOf ?? task.taskId, worker) };
      }
    },
    // Re-run the delegate check at hand-over: a delegate fired, removed or
    // moved to a flow that takes no tasks since the filing is refused here,
    // with the claim held, so the task fails and the conversation hears it.
    // A post row's delegate is checked for a post instead.
    flowKind: async (task, ctx) => {
      if (postOf(task) !== undefined) {
        if (options.postFlow === undefined) throw new Error(`Task "${task.taskId}" is a post, and this board hands over none.`);
        return options.postFlow(ctx, task.assignee);
      }
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
    // from server-written data. A filer that works for a workstream (its
    // lead's session, or a task filed from one) passes the workstream down,
    // so a coding run in the task session finds its project (FIX-1793 S6);
    // one that belongs to a project (a project's conversation, or a task
    // filed from one) passes the project down the same way. A post row's
    // delegate session is born naming its worker and the conversation only,
    // as a delivery's always was; a session by id is never created.
    state: async (task, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      if (postOf(task) !== undefined) {
        return { [WORKER_ID_STATE_KEY]: task.assignee, [FILING_SESSION_STATE_KEY]: partition };
      }
      const flow = (await options.delegates(ctx)).available.get(task.assignee);
      // The session's task: a follow-up's root, though the root's own
      // hand-over has already opened it, so this is only ever the root.
      const taskId = claimOf(ctx)?.followUpOf ?? task.taskId;
      const workstream = filingWorkstreamOf(ctx.session.state);
      const project = filingProjectOf(ctx.session.state);
      return {
        [WORKER_ID_STATE_KEY]: task.assignee,
        [FILING_SESSION_STATE_KEY]: partition,
        [FILING_FLOW_STATE_KEY]: options.flowKind,
        [TASK_ID_STATE_KEY]: taskId,
        [TASK_CHAIN_STATE_KEY]: chainOfFiling(ctx, partition, taskId).birth,
        ...(flow !== undefined ? { [TASK_FLOW_STATE_KEY]: flow } : {}),
        ...(workstream === undefined ? {} : { [FILING_WORKSTREAM_STATE_KEY]: workstream }),
        ...(project === undefined ? {} : { [FILING_PROJECT_STATE_KEY]: project })
      };
    }
  };
  const dispatchToDelegate = markDispatcher(
    handler({
      name: "conversation-board-dispatch",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("The conversation board's dispatch runs through the board, never on its own.");
      }
    }),
    address
  );

  const board = taskBoard({
    name: "conversation-tasks",
    boardId: CONVERSATION_LEDGER_ID,
    collection: conversationLedger,
    workers: {},
    defaultWorker: dispatchToDelegate as never,
    dispatcher: startableOnly,
    // Exit once nothing this run can start is waiting. An unassigned row
    // waits on the board for `assignTask`, so a run must not wait on it.
    onIdle: "wait",
    shouldExit: (collection) => !hasStartable(collection)
  });

  /**
   * The ledger the tools and actions write through: the running session's
   * own board, guarded. A filing past the chain's limits is refused before
   * anything is written. A filing or an assign that leaves a row startable
   * wakes the board, and a retried one wakes it again; so does an answer. No
   * caller write reaches a notice marker or a split marker. A write that ends
   * a split task cancels its open pieces, down the chain.
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
      // In a task session, the row is a piece of the task it was filed for:
      // server-written, so its settle reads only its own pieces. Filed in the
      // turn a piece's failure woke, it is that piece's retry.
      const owner = await pieceOwnerOf(ctx);
      const retrying = owner === undefined ? undefined : retryingPiece(ctx);
      const given = callerMetadata(init.metadata);
      const metadata =
        owner === undefined
          ? given
          : { ...(given ?? {}), [PIECE_OF]: owner, ...(retrying !== undefined ? { [RETRY_OF]: retrying } : {}) };
      const input = ownProjectIn(init.input, filingProjectAddressOf(ctx.session.state));
      const added = await ref.addTask({
        ...init,
        ...(input !== undefined ? { input } : {}),
        id,
        maxAttempts: init.maxAttempts ?? TASK_ATTEMPTS,
        ...(assignee !== undefined ? { assignee } : {}),
        ...(metadata !== undefined ? { metadata } : {})
      });
      if (chain.top !== undefined) await markAddedInChain(ctx, chain.top, [entry]);
      if (isStartable(added)) await wake(ctx);
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
    /**
     * A post row is settled only by its delegate's run, behind the claim gate:
     * a caller may cancel it, never complete, fail or block it, so no answer
     * lands that its delegate didn't give.
     */
    const runOnly =
      (write: (id: string, ...rest: any[]) => Promise<TaskWriteOutcome>) =>
      async (id: string, ...rest: any[]): Promise<TaskWriteOutcome> => {
        const row = ref.get(id);
        if (isPostRow(row)) return { outcome: "declined", reason: "disallowed", status: row!.status };
        return write(id, ...rest);
      };
    return {
      ...ref,
      addTask,
      complete: runOnly(ending(ref.complete.bind(ref))) as TaskCollectionRef["complete"],
      fail: runOnly(ending(ref.fail.bind(ref))) as TaskCollectionRef["fail"],
      // A cancelled post row owes no notice (only a waited-on row's turn hears a
      // cancel), so its ending is sent here: its round closes now, not at
      // its deadline. A send that fails leaves that to the deadline.
      cancel: (async (id: string, ...rest: any[]) => {
        const outcome = await ending(ref.cancel.bind(ref))(id, ...rest);
        const row = ref.get(id);
        if (outcome.outcome !== "declined" && isPostRow(row) && row!.status === "cancelled") {
          try {
            await dispatchThroughSeam(ctx, {
              type: "internal",
              action: POST_SETTLED_ENTRY,
              session: { id: ctx.session.identity.id },
              payload: { boardId: CONVERSATION_LEDGER_ID, taskId: id, attempt: row!.attempts, ending: "cancelled" },
              from: "conversation-board-cancel"
            });
          } catch {
            // Its round closes at its deadline.
          }
        }
        return outcome;
      }) as TaskCollectionRef["cancel"],
      block: runOnly(ending(ref.block.bind(ref))) as TaskCollectionRef["block"],
      async addTasks(inits) {
        const added: Task[] = [];
        for (const init of inits) added.push(await addTask(init));
        return added;
      },
      async setAssignee(id, assignee) {
        // A post row goes to the delegate it was handed to, in that delegate's session.
        const row = ref.get(id);
        if (isPostRow(row)) return { outcome: "declined", reason: "immutable-assignee", status: row!.status };
        const outcome = await ref.setAssignee(id, assignee);
        // `unchanged` too: an assign retried after a lost wake starts the row.
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await wake(ctx);
        return outcome;
      },
      // A recorded row readied by `dispatchTask` starts the board, through the
      // same test as an assign: `unchanged` too, so a dispatch replayed after
      // a lost wake starts the row (FIX-1875).
      ...(ref.dispatch === undefined
        ? {}
        : {
            async dispatch(id: string, dispatchOptions: Parameters<NonNullable<TaskCollectionRef["dispatch"]>>[1]) {
              const outcome = await ref.dispatch!(id, dispatchOptions);
              if (outcome.outcome !== "declined" && hasStartable(ref, id)) await wake(ctx);
              return outcome;
            }
          }),
      // An answer re-queues the row assigned and pending, which is its start
      // owed, in the unpark's own write (FIX-1817); then it starts the board,
      // as a filing does. A lost wake leaves the row startable for the next touch.
      async unpark(id, feedback, unparkOptions) {
        const outcome = await ref.unpark(id, feedback, unparkOptions);
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
    const rows = ref.list();
    await replayNotices(ctx, rows);
    // And the settles owed down the chain: each parked split row's session
    // settles its task once its pieces are done, this one's included, behind
    // any turn it is running (FIX-1802 BR-17).
    await replaySplits(ctx, rows);
    await settleIfOwedLater(ctx);
    // No board to act on while the session doesn't file: none of its
    // delegates takes a task now, so an action answers `no_delegation_board`.
    if (!(await files(ctx))) return undefined;
    return guarded(ctx, ref, partition);
  };

  /**
   * After a run: send what the rows owe, including what this run's own
   * refusals and settled dead runs owe; resume each turn a waited-on row's
   * ending still owes (`resumeOwedWaits`): a run of the board is a touch, and
   * not a turn; run the board of each parked split row's session, down the
   * chain; mark each of this board's pieces added in its chain (a crash
   * between an add and its mark leaves it reserved, and the lease must never
   * drop a piece that landed); and, in a task session whose pieces are all
   * done, settle its task, behind any turn it is running.
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
      // One of two resume touches, with the notice entry's (`./task-settled`),
      // which is the fast path and keeps the notice owed until the resume
      // lands. Neither has to win: the gate admits one answer and refuses the
      // other `already-resolved`, and either outcome clears `resumeOwed`.
      await resumeOwedWaits(ctx as never, ref);
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
   * The task tools for the model's turn: one capability instance, whose
   * tools are on a turn only while the session files, read before each model
   * call. Orchestration's own tools over this board's resolver and roster;
   * `controlTools`, as Orchestration's capability carries them, so a worker's
   * `tools:` line doesn't fence them out.
   */
  // Chosen per turn: a wait is offered only where the host can hold one
  // (FIX-1816). This board resumes waits: its notice entry and every run call
  // `resumeOwedWaits`. And it dispatches (FIX-1875): its ref's filings and
  // dispatches wake a run of it, so `dispatchTask` starts work now.
  // On a turn routing a post (FIX-1872), `dispatchTask` also takes its post
  // form; a session that files no task gets that one tool alone.
  const eight = taskToolsForTurn(resolver, roster, {
    resumesWaits: true,
    dispatches: true,
    ...(options.posts === undefined ? {} : { posts: options.posts })
  });
  const posts = options.posts;
  const tools = defineCapability({
    name: "taskTools",
    resources: { ...conversationLedgerResources, ...taskChainResources },
    presets: {
      tools: {
        controlTools: async (ctx) => {
          if (await files(ctx as never)) return eight(ctx as never);
          if (posts === undefined || !posts.routing(ctx as never)) return [];
          return eight(ctx as never).filter((tool) => tool.name === "dispatchTask");
        }
      },
      default: ["tools"]
    }
  });

  /**
   * File a post row on the running conversation's board, ready, and start it
   * (FIX-1872): the coordinator's one way to hand a post on, under every
   * policy and in every round. Not through the caller-facing guard: a post
   * row is the coordinator's own, in no chain, with one attempt, and its
   * payload is server-written. A wake lost after the add leaves the row
   * startable for the next touch, as any filing's.
   *
   * @param init The row, with the id derived from its post, round and
   *   delegate record, so a repeat finds it.
   * @returns `exists` when a row with that id is already on the board: the
   *   delegate was already handed this post in this round.
   * @throws when the conversation keeps no board, or the add is refused (a
   *   full board): the post wasn't handed on.
   */
  const filePost = async (ctx: BlockContext, init: TaskInit & { id: string }): Promise<"filed" | "exists"> => {
    const ref = await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
    if (ref === undefined) throw new Error("this conversation keeps no board to hand the post on through");
    if (ref.get(init.id) !== undefined) return "exists";
    try {
      await ref.addTask(init);
    } catch (error) {
      // Two routings of one post at once: the other's add landed first.
      if (ref.get(init.id) !== undefined) return "exists";
      throw error;
    }
    await wake(ctx);
    return "filed";
  };

  return {
    board,
    roster,
    resolver,
    runBoard,
    filePost,
    files,
    tools,
    /** The task tools as public actions, `<tool>_tasks`, `dispatchTask_tasks` among them. */
    actions: taskToolActions(CONVERSATION_LEDGER_ID, resolver, roster, { dispatches: true }),
    /** The ledger and the chain records, for the flow's `resources`. */
    resources: { ...conversationLedgerResources, ...taskChainResources }
  };
}

export type ConversationBoard = ReturnType<typeof defineConversationBoard>;
