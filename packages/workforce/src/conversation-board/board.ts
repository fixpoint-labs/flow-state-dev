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
 *   then waits on (`./split`), for any worker on the user's roster that takes
 *   a task (`rosterTaskTakers`), its delegates or not. Delegates stay the
 *   reporting line: an unassigned row goes to the only one.
 * - **Steps for itself** (FIX-2076 D1). On a flow that plans its turns
 *   ({@link ConversationBoard.planned}), a worker's own turn is offered the
 *   task tools whether or not it has delegates, and a filing that names the
 *   worker itself is a *step*: a row on the session's plan ledger (`./plan`),
 *   worked by the same request after the turn, never a child session of
 *   itself. The tools list both ledgers and route each write by the row: a
 *   step can be edited before it starts, or cancelled, never completed,
 *   failed or held by a call (its turn's answer is its result), and its
 *   assignee doesn't cross to a delegate, nor a delegate's to the worker. A
 *   filing naming the worker from anywhere but its own turn, such as a public
 *   action, is refused.
 * - **The limits** (FIX-1802 S5). A filing past the chain's depth or its
 *   breadth is refused in the ref the resolver returns (`./chain`), as the
 *   task substrate refuses a full board: `total_task_cap_exceeded`.
 * - **The tools and the actions.** Orchestration's task tools, `dispatchTask` among them, on the
 *   model's turn and as public actions, over one resolver and one roster. The
 *   tools are one capability whose tools are on a turn only while the session
 *   files, read per call. The resolver is the running session's own board,
 *   and none while it doesn't file, so an action answers
 *   `no_delegation_board`. The roster is the session's delegates that take a
 *   task, and in a task session every worker on the user's roster that takes
 *   one, read on every call.
 * - **The start.** A filing or an assign dispatches a run of the board into
 *   the conversation as a request of its own, and returns without waiting for
 *   it. The start it owes is the row's own state, pending and assigned
 *   (`./ledger`), so a refused or lost wake strands nothing: any later action
 *   on the board starts every row in that state. A session works one task at
 *   a time (FIX-2080): a row whose session another started, unfinished row
 *   holds waits, and starts once that row ends.
 * - **The settings** (FIX-2080). A task runs in a session of its own, or, filed
 *   `session: "ongoing"`, in the delegate's session for this conversation; its
 *   result goes to its filer, or, filed `resultTo: "conversation"`, to the
 *   conversation, with one attempt. A task's session takes neither: the add
 *   refuses them there, naming the setting.
 * - **Posts** (FIX-1872). A coordinator files a row per delegate it hands a
 *   post to, through {@link ConversationBoard.filePost}: the post in the
 *   row's server-written payload (`../coordinator/delegated-post`). The
 *   hand-over sends such a row to the delegated-post entry on the delegate's
 *   flow, in the session written on the row, never a task session, after the
 *   delegate check for a post. Its assignee can't be changed.
 * - **The pass** (FIX-2078). One run of the board, `runTaskBoard`, one at a
 *   time per session (`reject`): repairs first (orchestration's
 *   `payBoardDebts`: cancels, cascades, resumes, notices past due; reports
 *   stored before the upgrade; the settles owed down the chain), then the
 *   drain, then the repairs again, whose last ready check is the last step
 *   before the session's wake moves to the next debt's due time or clears.
 *   Every write that owes a start (a filing, an assign, an answer, a release)
 *   owes that wake first, then runs the pass. A touch of the board runs the
 *   pass only when something is startable or past due; it resends nothing.
 */
import {
  payBoardDebts,
  settlePassWake,
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
  TaskFilingRefusedError,
  TaskWriteRefusedError,
  assertDepsFileable,
  assertFilingCallerContext,
  assertFilingSettings,
  assertFollowUpHasRun,
  assertUniqueIds,
  hasStarted,
  isClaimable,
  isTerminalStatus,
  NOTICE_DUE_MS,
  noticeDueAt,
  filerResolver,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorkerInput,
  type TaskWriteOutcome
} from "@flow-state-dev/orchestration/tasks";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import { carriedHopState } from "../messages/hop";
import type { BlockContext, BlockDefinition, DispatchAddress, TaskTargetQuery } from "@flow-state-dev/core/types";
import { z } from "zod";
import { DELEGATED_POST_ENTRY, WORKER_TASK_ENTRY } from "../worker-task-entry";
import { isPostRow, postRowOf } from "../coordinator/delegated-post";
import type { TaskDelegates } from "../delegates/worker-delegates";
import { delegateKey } from "../delegates/delegate-list";
import { cancelIfParentEnded, stampFiledMarker } from "./cascade";
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
  CONVERSATION_BOARD_SETTINGS,
  conversationLedgerAt,
  conversationLedgerResources
} from "./ledger";
import { sendPostCancelled } from "./notice-delivery";
import { conversationDelivery } from "./delivery";
import { owedReports, sendLegacyReports } from "./report-owed";
import { cascadeIfSplit, pieceOwnerOf, replaySplits, retryingPiece, settleIfOwedLater, settleOwed } from "./split";
import { STEP_ATTEMPTS, definePlanning, isAnsweringTurn, isSteppingTurn, planLedgerAt, planLedgerResources } from "./plan";
import { verifiedWorkerOf } from "../workers/verified-worker";

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
   * Every worker on the session user's roster that takes a task now, read per
   * call: who a task session's pieces can go to, beside its delegates. A
   * session that works no task never reads it.
   */
  rosterTaskTakers: (ctx: BlockContext) => Promise<TaskDelegates>;
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

/**
 * A batch in an order each row's dependencies within it come first, so each
 * add finds them on the board. The batch was checked to close no loop.
 */
function dependencyOrder<T extends { id: string; deps?: string[] }>(batch: readonly T[]): T[] {
  const byId = new Map(batch.map((row) => [row.id, row]));
  const ordered: T[] = [];
  const placed = new Set<string>();
  const place = (row: T): void => {
    if (placed.has(row.id)) return;
    placed.add(row.id);
    for (const dep of row.deps ?? []) {
      const inBatch = byId.get(dep);
      if (inBatch !== undefined) place(inBatch);
    }
    ordered.push(row);
  };
  for (const row of batch) place(row);
  return ordered;
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
 * A turn's roster: the board's, plus the worker itself, whose filing is a step
 * it works next in the same request (FIX-2076 D1).
 */
function withSelf(roster: AssigneeRoster, self: string): AssigneeRoster {
  return {
    has: (name) => name === self || roster.has(name),
    describe: () => `${roster.describe()}. Yourself ("${self}"): a step you work next, in this request`,
    ...(roster.soleAssignee === undefined ? {} : { soleAssignee: roster.soleAssignee })
  };
}

/** The refusal for a filing naming the worker itself from anywhere but its own turn. */
const stepFromItsOwnTurn = (self: string) =>
  new TaskWriteRefusedError(
    "step_from_its_own_turn",
    `"${self}" is this session's own worker: a step for itself is filed only by its own turn, on a flow that works its steps, ` +
      "and it works the step in that same request. File it for a delegate instead. Nothing was filed."
  );

/** The refusal for an assignee change that crosses the worker itself. */
const filedApart = (taskId: string) =>
  new TaskWriteRefusedError(
    "step_and_task_filed_apart",
    "a step for yourself and a task for a delegate are filed apart: cancel and file again. Nothing was written.",
    taskId
  );

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
 * The `session` setting of the row the board is handing over, read off the
 * row on its own board (FIX-2080): server-written at filing, never input.
 */
async function sessionSettingOf(ctx: BlockContext, taskId: string): Promise<Task["session"]> {
  const ref = await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
  return ref?.get(taskId)?.session;
}

/**
 * The claim the board's dispatch holds while it addresses a task: on its
 * worker body's state, or in the claimed worker's async scope. Server-derived:
 * minted from the row the board just claimed.
 */
function claimOf(ctx: BlockContext): { assignee?: string; followUpOf?: string } | undefined {
  const onState = (ctx.sequencer?.state as { currentClaim?: { assignee?: string; followUpOf?: string } } | undefined)
    ?.currentClaim;
  return onState ?? currentWorkerClaim(ctx);
}

/**
 * The session a row runs in, as the one-open-task rule keys it (FIX-2080):
 * a task's own session (its root's, for a follow-up), or the delegate's
 * ongoing session for the conversation. `undefined` for a post row, which
 * is not a task of a session yet (FIX-2083 routes it).
 */
function sessionKeyOf(task: Pick<Task, "id" | "assignee" | "followUpOf" | "session" | "sealed">): string | undefined {
  if (isPostRow(task as Task) || task.assignee === undefined) return undefined;
  if (task.session === "ongoing") return `delegate:${delegateKey({ worker: task.assignee })}`;
  return taskSessionKey(task.followUpOf ?? task.id, task.assignee);
}

/**
 * Whether the row holds its session: started and unfinished, a retry
 * waiting to run again included. A held row hasn't started.
 */
function holdsSession(task: Task): boolean {
  return !isTerminalStatus(task.status) && task.status !== "held" && hasStarted(task);
}

/**
 * The board's one test for "may start" (FIX-1875 S6, FIX-2080): the row names
 * a delegate, and no other started, unfinished row holds the session it runs
 * in (one open task per session). Every start path reads it: the claim, the
 * drain's exit, and the wakes after a filing, an assign, an answer, a release
 * and a touch. Claimability (status, deps, lease) is the substrate's, read
 * beside it; a held row is never claimable.
 *
 * @param rows The board's rows, as the claim write reads them.
 */
export function isStartable(task: Task, rows: readonly Task[]): boolean {
  if (task.assignee === undefined) return false;
  const key = sessionKeyOf(task);
  if (key === undefined) return true;
  return !rows.some((other) => other.id !== task.id && holdsSession(other) && sessionKeyOf(other) === key);
}

/** Claims only rows that may start: an unassigned row, or one whose session is busy, waits on the board. */
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
  const rows = collection.list();
  return rows.some(
    (task) =>
      (task.status === "pending" || task.status === "in_progress") &&
      (id === undefined || task.id === id) &&
      isStartable(task, rows) &&
      isClaimable(task, lookup, now)
  );
}

/**
 * A touch that starts what the board owes: the pass, when a row is startable
 * now (a follow-up whose session just freed included). Never fails the caller.
 */
export async function wakeIfStartable(ctx: BlockContext, collection: TaskCollectionRef): Promise<void> {
  if (hasStartable(collection)) await triggerPass(ctx);
}

/**
 * Owe the running session's pass a wake, due in seconds (FIX-2078): before a
 * write that owes a start, so a crash after the write leaves the debt a due
 * time. A host that keeps no wakes has the fast path only. Never fails.
 */
async function owePass(ctx: BlockContext): Promise<void> {
  try {
    await ctx.requestHost?.wakes?.owe({ entry: RUN_BOARD_ENTRY, dueAt: Date.now() + NOTICE_DUE_MS });
  } catch {
    // The fast path still runs.
  }
}

/**
 * Run the session's pass: dispatch `runTaskBoard` into the running session, as
 * a request of its own, owing its wake first. Never waits for it, and never
 * fails the caller: a pass already running refuses it (one at a time), and
 * its last ready check, or the wake, covers what it would have done.
 */
export async function triggerPass(ctx: BlockContext): Promise<void> {
  await owePass(ctx);
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: RUN_BOARD_ENTRY,
      session: { id: ctx.session.identity.id },
      payload: {},
      from: "conversation-board-wake"
    });
  } catch {
    // The wake runs it.
  }
}

/** Whether any debt on the board is past its due time: the touch runs the pass for it. */
function hasPastDue(rows: readonly Task[], now: number): boolean {
  return rows.some((row) => {
    const notice = noticeDueAt(row);
    if (notice !== undefined && notice <= now) return true;
    if (row.cascadeOwed != null && row.cascadeOwed.due <= now) return true;
    if ((row.resumeOwed === true || row.cancelOwed === true) && row.updatedAt + NOTICE_DUE_MS <= now) return true;
    // A report owed by a row stored before FIX-2078: due at once (BP-030).
    return owedReports(row).length > 0;
  });
}

/** The most rounds of drain and repair one pass runs. */
const MAX_PASS_ROUNDS = 3;

/** Rounds run so far, by pass request. */
const passRounds = new Map<string, number>();

/** The pass's wake as read at its start, by request: settled at its end against that version. */
const passWakes = new Map<string, Awaited<ReturnType<NonNullable<NonNullable<BlockContext["requestHost"]>["wakes"]>["read"]>>>();

/**
 * Build a conversation's task board and everything a flow carrying it
 * declares: the drain behind the run entry, the tools for the model's turn,
 * the actions, and the ledger.
 */
export function defineConversationBoard(options: ConversationBoardOptions) {
  /**
   * Who a filing in the running session can name, read now: its delegates
   * that take a task, and in a task session (its pieces) every worker on the
   * user's roster that takes one too. Server-side only: the session's task
   * and its delegate list are server-written state, never input.
   */
  const reach = async (ctx: BlockContext): Promise<{ reachable: TaskDelegates; delegates: TaskDelegates; taskSession: boolean }> => {
    const delegates = await options.delegates(ctx);
    const state = (ctx.session.state ?? {}) as Record<string, unknown>;
    if (typeof state[TASK_ID_STATE_KEY] !== "string") return { reachable: delegates, delegates, taskSession: false };
    // The session's own worker may be on the roster too; a filing that names
    // it is a step, not a piece (`withSteps` below, FIX-2076).
    const roster = await options.rosterTaskTakers(ctx);
    const available = new Map([...delegates.available, ...roster.available]);
    const unavailable = new Map([...delegates.unavailable, ...roster.unavailable].filter(([worker]) => !available.has(worker)));
    return { reachable: { available, unavailable }, delegates, taskSession: true };
  };

  /** The roster the task tools and actions check an assignee against; its sole assignee is still the only delegate. */
  const roster: AssigneeRosterSource = async (ctx) => {
    const { reachable, delegates } = await reach(ctx);
    return { ...rosterOf(reachable), soleAssignee: rosterOf(delegates).soleAssignee };
  };

  /**
   * Whether the running session files now (FIX-1802 D1): one of its
   * delegates takes a task, read from its list as it stands; in a task
   * session, any worker on the roster that takes one. So a task session with
   * no delegates still files when the roster has a task taker: deliberate.
   */
  const files = async (ctx: BlockContext): Promise<boolean> => (await reach(ctx)).reachable.available.size > 0;

  /** The flow's planning: its turns, wrapped so the steps they file run in their request (FIX-2076). */
  const planning = definePlanning();

  /** The worker this request's turn was verified to run as, when steps are worked on this flow. */
  const stepper = (ctx: BlockContext): string | undefined => (planning.wired() ? verifiedWorkerOf(ctx.session) : undefined);

  /** A turn's roster: the board's, with the worker itself when it works steps. */
  const turnRoster: AssigneeRosterSource = async (ctx) => {
    const base = await roster(ctx);
    const self = stepper(ctx);
    return self === undefined ? base : withSelf(base, self);
  };

  /** Whether a turn gets the task tools: it files for a delegate, or it works steps for itself (FIX-2076 D1). */
  const turnFiles = async (ctx: BlockContext): Promise<boolean> => stepper(ctx) !== undefined || (await files(ctx));

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
      by: async (task, ctx) => {
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
        // A task filed `session: "ongoing"` runs in the delegate's session for
        // this conversation (FIX-2080), read off the row the board claimed.
        if ((await sessionSettingOf(ctx, task.taskId)) === "ongoing") {
          return { key: `delegate:${delegateKey({ worker })}` };
        }
        // A follow-up runs in the session of the task it follows (FIX-1817):
        // keyed by that root task, from the claim, never from input.
        return { key: taskSessionKey(claim?.followUpOf ?? task.taskId, worker) };
      }
    },
    // Re-run the check at hand-over: a delegate (or, for a task session's
    // pieces, a roster worker) fired, removed or moved to a flow that takes
    // no tasks since the filing is refused here, with the claim held, so the
    // task fails and the conversation hears it.
    // A post row's delegate is checked for a post instead.
    flowKind: async (task, ctx) => {
      if (postOf(task) !== undefined) {
        if (options.postFlow === undefined) throw new Error(`Task "${task.taskId}" is a post, and this board hands over none.`);
        return options.postFlow(ctx, task.assignee);
      }
      const { reachable, taskSession } = await reach(ctx);
      const flow = reachable.available.get(task.assignee);
      if (flow !== undefined) return flow;
      const why =
        reachable.unavailable.get(task.assignee) ??
        (taskSession ? "it isn't a worker on this roster that takes tasks" : "it isn't one of this conversation's delegates");
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
      const flow = (await reach(ctx)).reachable.available.get(task.assignee);
      // The delegate's ongoing session for the conversation works no one
      // task (FIX-2080): born naming its worker, the conversation and the
      // flow that filed into it, and no task or chain place. One that exists
      // keeps its own state.
      if ((await sessionSettingOf(ctx, task.taskId)) === "ongoing") {
        return {
          [WORKER_ID_STATE_KEY]: task.assignee,
          [FILING_SESSION_STATE_KEY]: partition,
          [FILING_FLOW_STATE_KEY]: options.flowKind,
          ...(flow !== undefined ? { [TASK_FLOW_STATE_KEY]: flow } : {})
        };
      }
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
        // The filer's worker-message hop count and chain (FIX-1989): a
        // message from the task counts on in the exchange of the turn that
        // filed it. Never the task chain's.
        ...carriedHopState(ctx.session.state),
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
    // Every row goes to a delegate's session; the run doesn't wait on one.
    mode: "delegation",
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
   * The chain's half of a filing, shared by a task for a delegate and a step:
   * the row's id, minted now so its place is reserved first, and its entry
   * reserved under the chain's top. A filing that opens a session (a task for
   * a delegate) is refused one board past the deepest; a step opens none, so
   * it adds no depth and skips that check. Call `markFiled` once the add lands.
   */
  const reserveFiling = async (
    ctx: BlockContext,
    ledger: TaskCollectionRef,
    partition: string,
    init: TaskInit,
    opensSession: boolean
  ): Promise<{ id: string; markFiled: () => Promise<void> }> => {
    const id = init.id ?? newTaskId();
    const chain = chainOfFiling(ctx, partition, id);
    if (opensSession && chain.depth > MAX_TASK_DEPTH) {
      // The board one past the deepest takes no task.
      throw new TaskCapExceededError({ cap: "total", limit: MAX_TASK_DEPTH, attempted: chain.depth, collectionId: ledger.collectionId });
    }
    const entry = chainEntryKey(partition, id);
    const top = chain.top;
    if (top !== undefined) {
      await reserveInChain(ctx, {
        top,
        entry,
        limit: options.chainLimit?.() ?? DEFAULT_TASK_CHAIN_LIMIT,
        now: ledger.now(),
        collectionId: ledger.collectionId
      });
    }
    return { id, markFiled: async () => (top === undefined ? undefined : markAddedInChain(ctx, top, [entry])) };
  };

  /**
   * The ledger the tools and actions write through: the running session's
   * own board, guarded. A filing past the chain's limits is refused before
   * anything is written. A filing or an assign that leaves a row startable
   * wakes the board, and a retried one wakes it again; so does an answer. No
   * caller write reaches a notice marker or a split marker. A write that ends
   * a split task cancels its open pieces, down the chain.
   */
  const guarded = (ctx: BlockContext, ref: TaskCollectionRef, partition: string): TaskCollectionRef => {
    // The worker itself is no delegate: its step is a plan row (`withSteps`,
    // which takes such a filing before it reaches here), never a child session
    // of itself (FIX-2076).
    const self = verifiedWorkerOf(ctx.session);
    const fromTaskSession = typeof ((ctx.session.state ?? {}) as Record<string, unknown>)[TASK_ID_STATE_KEY] === "string";
    /**
     * Every check a row passes before anything is written (FIX-2080): the
     * worker isn't its own delegate, a task's session asks for neither
     * conversation setting, and the board takes the settings asked for. A
     * batch runs these for every row before its first add.
     */
    const checkFiling = (init: TaskInit): void => {
      if (self !== undefined && init.assignee === self) throw stepFromItsOwnTurn(self);
      assertFilingCallerContext(init, { fromTaskSession });
      assertFilingSettings(init, CONVERSATION_BOARD_SETTINGS, ref.collectionId);
      assertFollowUpHasRun(init, (id) => ref.get(id));
    };
    /** Add one checked row under its chain reservation. */
    const fileReserved = async (init: TaskInit, reserved: { id: string; markFiled: () => Promise<void> }): Promise<Task> => {
      const { id, markFiled } = reserved;
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
      // The task this piece is for learns where its session is first, so its
      // ending's cascade can reach the piece (FIX-2080 D2).
      if (owner !== undefined) await stampFiledMarker(ctx, owner, conversationLedgerAt);
      // A start owed has a due time before the row exists (FIX-2078).
      await owePass(ctx);
      const added = await ref.addTask({
        ...init,
        ...(input !== undefined ? { input } : {}),
        id,
        // A conversation-result task has one attempt (FIX-2080).
        maxAttempts: init.maxAttempts ?? (init.resultTo === "conversation" ? 1 : TASK_ATTEMPTS),
        ...(assignee !== undefined ? { assignee } : {}),
        ...(metadata !== undefined ? { metadata } : {})
      });
      await markFiled();
      if (owner !== undefined && (await cancelIfParentEnded(ctx, owner, ref, added.id, conversationLedgerAt))) {
        return ref.get(added.id) ?? added;
      }
      if (added.status !== "held" && isStartable(added, ref.list())) await triggerPass(ctx);
      return added;
    };
    const addTask: TaskCollectionRef["addTask"] = async (init) => {
      checkFiling(init);
      return fileReserved(init, await reserveFiling(ctx, ref, partition, init, true));
    };
    /**
     * The options a write on this board presents: a claim the running
     * session holds on a row of another board (a task session's own task)
     * asks nothing of this one, so it is left off.
     */
    const ownClaim = (guards: unknown): unknown => {
      const claim = (guards as { claim?: { partition?: string; collectionId?: string } } | undefined)?.claim;
      // A step's claim, held by its inline turn (FIX-2076), is on another ledger too.
      return claim !== undefined && (claim.partition !== partition || claim.collectionId !== ref.collectionId)
        ? { ...(guards as object), claim: undefined }
        : guards;
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
     * a caller may cancel it, never complete, fail or hold it, so no answer
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
          await sendPostCancelled(ctx, row!, { session: { id: ctx.session.identity.id }, from: "conversation-board-cancel" });
        }
        return outcome;
      }) as TaskCollectionRef["cancel"],
      // A hold is a caller's write a post row refuses, like a settle; a release
      // or a settings change that leaves a row startable starts the board.
      hold: runOnly(ref.hold.bind(ref)) as TaskCollectionRef["hold"],
      async release(id) {
        await owePass(ctx);
        const outcome = await ref.release(id);
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      async patchSettings(id, patch) {
        await owePass(ctx);
        const outcome = await ref.patchSettings(id, patch);
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      async addTasks(inits) {
        // A refused batch files nothing (FIX-2080): every row's checks, the
        // batch's dependencies (its own ids count) and every row's place in
        // the chain come first. A reservation a later refusal strands lapses
        // with its lease. Then each row is added after the rows it depends on.
        assertUniqueIds(inits);
        const batch = dependencyOrder(inits.map((init) => ({ ...init, id: init.id ?? newTaskId() })));
        for (const init of batch) checkFiling(init);
        assertDepsFileable(batch, (id) => ref.get(id));
        const reserved: Array<{ id: string; markFiled: () => Promise<void> }> = [];
        for (const init of batch) reserved.push(await reserveFiling(ctx, ref, partition, init, true));
        const added: Task[] = [];
        for (const [i, init] of batch.entries()) added.push(await fileReserved(init, reserved[i]!));
        return added;
      },
      async setAssignee(id, assignee) {
        // A post row goes to the delegate it was handed to, in that delegate's session.
        const row = ref.get(id);
        if (isPostRow(row)) return { outcome: "declined", reason: "immutable-assignee", status: row!.status };
        if (self !== undefined && assignee === self) throw filedApart(id);
        await owePass(ctx);
        const outcome = await ref.setAssignee(id, assignee);
        // `unchanged` too: an assign retried after a lost wake starts the row.
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      // A recorded row readied by `dispatchTask` starts the board, through the
      // same test as an assign: `unchanged` too, so a dispatch replayed after
      // a lost wake starts the row (FIX-1875).
      ...(ref.dispatch === undefined
        ? {}
        : {
            async dispatch(id: string, dispatchOptions: Parameters<NonNullable<TaskCollectionRef["dispatch"]>>[1]) {
              if (self !== undefined && dispatchOptions.assignee === self) throw filedApart(id);
              await owePass(ctx);
              const outcome = await ref.dispatch!(id, dispatchOptions);
              if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
              return outcome;
            }
          }),
      // An answer re-queues the row assigned and pending, which is its start
      // owed, in the unpark's own write (FIX-1817); then it starts the board,
      // as a filing does. A lost wake leaves the row startable for the next touch.
      async unpark(id, feedback, unparkOptions) {
        await owePass(ctx);
        const outcome = await ref.unpark(id, feedback, unparkOptions);
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      async patchMetadata(id, patch) {
        return ref.patchMetadata(id, callerMetadata(patch) ?? {});
      }
    };
  };

  /**
   * The board as the tools see it, with the session's plan ledger beside it
   * (FIX-2076): a filing naming the worker itself goes on the plan ledger as a
   * step, any other to the board; both are listed; a write by id goes to the
   * ledger holding the row. A step counts toward the chain's breadth as a
   * piece does, and adds no depth: it runs in this session.
   *
   * @param routesSelf Whether this caller is the worker's own turn, which may
   *   file a step. Anywhere else a filing naming the worker is refused.
   */
  const withSteps = (
    ctx: BlockContext,
    board: TaskCollectionRef,
    plan: TaskCollectionRef,
    partition: string,
    self: string,
    routesSelf: boolean
  ): TaskCollectionRef => {
    /** Every check a step passes before anything is written. */
    const checkStep = (init: TaskInit): void => {
      if (!routesSelf) throw stepFromItsOwnTurn(self);
      if (isSteppingTurn(ctx)) {
        throw new TaskWriteRefusedError(
          "no_step_while_stepping",
          "you are working a step, and a step files no step for itself: do this step, and say in your answer what is left. Nothing was filed."
        );
      }
      if (isAnsweringTurn(ctx)) {
        throw new TaskWriteRefusedError(
          "no_step_while_answering",
          "your steps have ended and this turn gives your answer: do the work yourself, or answer. A task for a delegate is still dispatched. Nothing was filed."
        );
      }
      if (init.wait != null) {
        throw new TaskWriteRefusedError(
          "step_cannot_wait",
          "a step for yourself runs after this turn, in this request, so this turn can't wait on it. File it without wait, and you hear how it ended when it has. Nothing was filed."
        );
      }
      if (init.followUpOf !== undefined) {
        throw new TaskWriteRefusedError(
          "step_follows_nothing",
          "a step for yourself runs here, in this request, and follows up no task. File it without followUpOf. Nothing was filed."
        );
      }
      // A step runs in this request, after this turn, so nothing would release
      // one filed held (FIX-2080).
      if (init.held === true) {
        throw new TaskWriteRefusedError(
          "step_cannot_be_held",
          "a step for yourself runs after this turn, in this request, so it can't be filed held. File it without held, or file it later. Nothing was filed."
        );
      }
    };
    const fileStep: TaskCollectionRef["addTask"] = async (init) => {
      checkStep(init);
      const { id, markFiled } = await reserveFiling(ctx, plan, partition, init, false);
      const metadata = callerMetadata(init.metadata);
      const input = ownProjectIn(init.input, filingProjectAddressOf(ctx.session.state));
      const added = await plan.addTask({
        ...init,
        ...(input !== undefined ? { input } : {}),
        id,
        assignee: self,
        maxAttempts: init.maxAttempts ?? STEP_ATTEMPTS,
        ...(metadata !== undefined ? { metadata } : {})
      });
      await markFiled();
      return added;
    };
    /**
     * Each ledger resolves `deps` only among its own rows, so a dep on the
     * other ledger would never be met: neither a step waiting on a delegate's
     * task nor a delegate's task waiting on a step would ever start. Refused
     * at filing, before anything is written.
     */
    const depsOnOneLedger = (init: TaskInit, step: boolean): void => {
      const other = step ? board : plan;
      const across = (init.deps ?? []).filter((dep) => other.get(dep) !== undefined);
      if (across.length === 0) return;
      throw new TaskWriteRefusedError(
        "deps_across_ledgers",
        step
          ? `a step for yourself can depend only on your other steps, and ${across.map((dep) => `"${dep}"`).join(", ")} is a task for a delegate. ` +
              "Do the step after that task ends, from the turn its ending wakes. Nothing was filed."
          : `a task for a delegate can depend only on other tasks for delegates, and ${across.map((dep) => `"${dep}"`).join(", ")} is a step for yourself. ` +
              "Dispatch it once that step has ended, or give the delegate what it needs in the task. Nothing was filed."
      );
    };
    const isStepFiling = (init: TaskInit): boolean => init.assignee !== undefined && init.assignee === self;
    const addTask: TaskCollectionRef["addTask"] = async (init) => {
      const step = isStepFiling(init);
      depsOnOneLedger(init, step);
      return step ? fileStep(init) : board.addTask(init);
    };
    /** The ledger holding `id`: the plan ledger for a step, the board for anything else. */
    const holder = (id: string): TaskCollectionRef => (board.get(id) === undefined && plan.get(id) !== undefined ? plan : board);
    const isStep = (id: string): boolean => holder(id) === plan;
    /** A write by id, sent to the ledger holding the row. */
    const byRow =
      <K extends keyof TaskCollectionRef>(method: K) =>
      (id: string, ...rest: any[]) =>
        (holder(id)[method] as (...args: any[]) => any)(id, ...rest);
    /** A settle a step never takes from a call: its turn's answer is its result. */
    const notOnAStep =
      <K extends "complete" | "fail" | "hold">(method: K) =>
      (id: string, ...rest: any[]) => {
        if (isStep(id)) {
          throw new TaskWriteRefusedError(
            "step_settles_itself",
            `task "${id}" is a step you filed for yourself: it ends when its turn answers, so do the step and answer with its result. Nothing was written.`,
            id
          );
        }
        return (board[method] as (...args: any[]) => any)(id, ...rest);
      };
    return {
      ...board,
      addTask,
      async addTasks(inits) {
        // A refused batch files nothing (FIX-2080): the steps' checks and each
        // row's ledger come first, and the delegates' tasks go to the board as
        // one batch, which checks them whole before its first add.
        for (const init of inits) {
          const step = isStepFiling(init);
          depsOnOneLedger(init, step);
          if (step) checkStep(init);
        }
        const tasks = await board.addTasks(inits.filter((init) => !isStepFiling(init)));
        const steps: Task[] = [];
        for (const init of inits.filter(isStepFiling)) steps.push(await fileStep(init));
        const byInit = new Map<TaskInit, Task>();
        inits.filter((init) => !isStepFiling(init)).forEach((init, i) => byInit.set(init, tasks[i]!));
        inits.filter(isStepFiling).forEach((init, i) => byInit.set(init, steps[i]!));
        return inits.map((init) => byInit.get(init)!);
      },
      // Merged reads rely on task ids being unique across the two ledgers: both mint `task_<random>` ids.
      get: (id) => board.get(id) ?? plan.get(id),
      list: (filter) => [...board.list(filter), ...plan.list(filter)],
      count: (filter) => board.count(filter) + plan.count(filter),
      complete: notOnAStep("complete") as TaskCollectionRef["complete"],
      fail: notOnAStep("fail") as TaskCollectionRef["fail"],
      hold: notOnAStep("hold") as TaskCollectionRef["hold"],
      cancel: byRow("cancel") as TaskCollectionRef["cancel"],
      release: byRow("release") as TaskCollectionRef["release"],
      patchSettings: byRow("patchSettings") as TaskCollectionRef["patchSettings"],
      unpark: byRow("unpark") as TaskCollectionRef["unpark"],
      reopen: byRow("reopen") as TaskCollectionRef["reopen"],
      setPriority: byRow("setPriority") as TaskCollectionRef["setPriority"],
      addLabel: byRow("addLabel") as TaskCollectionRef["addLabel"],
      removeLabel: byRow("removeLabel") as TaskCollectionRef["removeLabel"],
      patchMetadata: async (id, patch) => holder(id).patchMetadata(id, callerMetadata(patch) ?? {}),
      async setAssignee(id, assignee) {
        // A step is the worker's, and a delegate's task a delegate's: the two are filed apart.
        if (isStep(id) !== (assignee === self)) throw filedApart(id);
        return holder(id).setAssignee(id, assignee);
      },
      ...(board.dispatch === undefined
        ? {}
        : {
            async dispatch(id: string, dispatchOptions: Parameters<NonNullable<TaskCollectionRef["dispatch"]>>[1]) {
              if (!isStep(id)) {
                if (dispatchOptions.assignee === self) throw filedApart(id);
                return board.dispatch!(id, dispatchOptions);
              }
              if (dispatchOptions.wait != null) {
                throw new TaskWriteRefusedError(
                  "step_cannot_wait",
                  `task "${id}" is a step for yourself: it runs after this turn, in this request, so this turn can't wait on it. Dispatch it without wait. Nothing was written.`,
                  id
                );
              }
              if (dispatchOptions.assignee !== undefined && dispatchOptions.assignee !== self) throw filedApart(id);
              if (plan.dispatch === undefined) {
                throw new TaskWriteRefusedError("step_not_dispatchable", `task "${id}" can't be started by its id. Nothing was written.`, id);
              }
              return plan.dispatch(id, { call: dispatchOptions.call });
            }
          })
    };
  };

  /**
   * The board as `routesSelf`'s caller reaches it, after its touch: the
   * session's own board, guarded, with its steps beside it when the worker
   * works steps (FIX-2076). `undefined` while the caller may file nothing.
   */
  const reachBoard = async (ctx: BlockContext, routesSelf: boolean): Promise<TaskCollectionRef | undefined> => {
    const partition = await filingSessionIdOf(ctx.session);
    const ref = await conversationLedgerAt(ctx, partition);
    if (ref === undefined) return undefined;
    // A touch runs the pass when something is startable or past due (FIX-2078):
    // the pass pays it, one at a time. A touch resends nothing itself. Don't
    // narrow it to writes, or to a session that files now: rows filed before
    // it lost its last task-taking delegate still run and are heard (FIX-1802 BR-5).
    // Its own split's settle, owed once its pieces are done, is paid there too.
    if (hasStartable(ref) || hasPastDue(ref.list(), ref.now()) || (await settleOwed(ctx))) await triggerPass(ctx);
    // No board to act on while the session doesn't file: none of its
    // delegates takes a task now, so an action answers `no_delegation_board`.
    // A turn of a worker that works steps files them whatever its delegates.
    if (!(await (routesSelf ? turnFiles(ctx) : files(ctx)))) return undefined;
    const board = guarded(ctx, ref, partition);
    const self = verifiedWorkerOf(ctx.session);
    const plan = planning.wired() && self !== undefined ? await planLedgerAt(ctx, partition) : undefined;
    return plan === undefined || self === undefined ? board : withSteps(ctx, board, plan, partition, self, routesSelf);
  };

  /** Every action on the board reaches it here: a caller's move, which files no step for the worker. */
  const resolver: TaskCollectionResolver = (ctx) => reachBoard(ctx, false);

  /** The model's every tool call reaches the board here: the worker's own turn, which may file its steps. */
  const turnResolver: TaskCollectionResolver = (ctx) => reachBoard(ctx, true);

  /** The repairs a pass runs before its drain, and again after (`payBoardDebts`). */
  const delivery = conversationDelivery(CONVERSATION_LEDGER_ID);
  const repairs = async (ctx: BlockContext, ref: TaskCollectionRef, partition: string, resend = true): Promise<number | undefined> => {
    const debts = await payBoardDebts(ctx, ref, {
      noticeEntry: delivery.noticeEntry!,
      onUndeliverable: delivery.onUndeliverable!,
      filerOf: filerResolver(delivery, ref.partition),
      resend
    });
    const rows = ref.list();
    // Reports stored before FIX-2078 (BP-030), once each.
    await sendLegacyReports(ctx, ref, rows, { boardId: CONVERSATION_LEDGER_ID, partition }, "conversation-board-report");
    // The settles owed down the chain: each parked split row's session
    // settles its task once its pieces are done, behind any turn it runs
    // (FIX-1802 BR-17); and this session's own, when its task is split.
    await replaySplits(ctx, rows);
    await settleIfOwedLater(ctx);
    let next = debts.nextDue;
    const later = (at: number) => {
      next = next === undefined ? at : Math.min(next, at);
    };
    if (await settleOwed(ctx)) later(Date.now() + NOTICE_DUE_MS);
    // The last ready check: a row still startable is a start owed.
    if (hasStartable(ref)) later(Date.now() + NOTICE_DUE_MS);
    return next;
  };

  /** The pass's first half: read its wake, then repair, before the drain. */
  const beforeDrain = handler({
    name: "conversation-board-before-drain",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    resources: { ...conversationLedgerResources, ...taskChainResources },
    execute: async (_input, ctx) => {
      passWakes.set(ctx.request.identity.id, await ctx.requestHost?.wakes?.read(RUN_BOARD_ENTRY));
      const partition = await filingSessionIdOf(ctx.session);
      const ref = await conversationLedgerAt(ctx, partition);
      if (ref !== undefined) await repairs(ctx as never, ref, partition);
      return {};
    }
  });

  /**
   * A round's last half: repair again (what the drain's own endings owe),
   * mark each of this board's pieces added in its chain (a crash between an
   * add and its mark leaves it reserved, and the lease must never drop a
   * piece that landed), and the last ready check: a row startable now (one a
   * retry or an ending made ready while this pass held its place, whose own
   * trigger was refused) runs another round, up to {@link MAX_PASS_ROUNDS}.
   */
  const afterRound = handler({
    name: "conversation-board-after-run",
    inputSchema: z.unknown(),
    outputSchema: z.object({ again: z.boolean(), nextDue: z.number().optional() }),
    resources: { ...conversationLedgerResources, ...taskChainResources },
    execute: async (_input, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      const ref = await conversationLedgerAt(ctx, partition);
      if (ref === undefined) return { again: false };
      const nextDue = await repairs(ctx as never, ref, partition, false);
      const top = taskChainOf(ctx)?.top;
      if (top !== undefined) await markAddedInChain(ctx, top, ref.list().map((row) => chainEntryKey(partition, row.id)));
      const rounds = (passRounds.get(ctx.request.identity.id) ?? 0) + 1;
      passRounds.set(ctx.request.identity.id, rounds);
      const again = hasStartable(ref) && rounds < MAX_PASS_ROUNDS;
      return nextDue === undefined ? { again } : { again, nextDue };
    }
  });

  /** The pass's last step: move the session's wake to the next debt's due time, or clear it. */
  const settleWake = handler({
    name: "conversation-board-settle-wake",
    inputSchema: z.object({ again: z.boolean(), nextDue: z.number().optional() }),
    outputSchema: z.object({ nextDue: z.number().optional() }),
    execute: async (round, ctx) => {
      const read = passWakes.get(ctx.request.identity.id);
      passWakes.delete(ctx.request.identity.id);
      passRounds.delete(ctx.request.identity.id);
      await settlePassWake(ctx as never, RUN_BOARD_ENTRY, read, round.nextDue);
      return round.nextDue === undefined ? {} : { nextDue: round.nextDue };
    }
  });

  /** One round of a pass: claim and hand over what can start, then repair. */
  const round = sequencer({ name: "conversation-run-board-round", inputSchema: z.unknown() })
    .step(board.drain)
    .step(afterRound);

  /** One pass of the board, in its own conversation, as its owner: repair, rounds of drain and repair, settle the wake. */
  const runBoard: BlockDefinition<any, any> = sequencer({ name: "conversation-run-board", inputSchema: z.unknown() })
    .tap(beforeDrain)
    .doWhile((value: { again?: boolean }) => value.again === true, round)
    .step(settleWake);

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
  // A task session's turn can't wait, but its task can: a piece filed without
  // `wait` parks the task when the turn ends, and the piece's ending wakes it
  // (`./split`). The refusal and the description say so.
  const eight = taskToolsForTurn(turnResolver, turnRoster, {
    resumesWaits: true,
    dispatches: true,
    taskTurnInstead:
      "To wait for it, file it without `wait`, then end this turn: when that task ends, its ending wakes this task in a new turn, with the result.",
    ...(options.posts === undefined ? {} : { posts: options.posts })
  });
  const posts = options.posts;
  const tools = defineCapability({
    name: "taskTools",
    resources: { ...conversationLedgerResources, ...planLedgerResources, ...taskChainResources },
    presets: {
      tools: {
        controlTools: async (ctx) => {
          if (await turnFiles(ctx as never)) return eight(ctx as never);
          if (posts === undefined || !posts.routing(ctx as never)) return [];
          return eight(ctx as never).filter((tool) => tool.name === "dispatchTask");
        },
        // The session's project, read from its server-written fields (BP-031),
        // so a filer in a workstream or a project's conversation never has to
        // guess one: the board writes it on every task filed here anyway.
        context: async (_input, ctx) => {
          const own = filingProjectAddressOf(ctx.session.state);
          if (own === undefined || !(await files(ctx as never))) return undefined;
          // A project id is its creator's text and may hold quotes, so it goes
          // in as a JSON string: it can't close the name and start a sentence.
          return (
            `This conversation works in the ${own.visibility} project ${JSON.stringify(own.id)}. ` +
            "Every task you file here works in that project, so leave `project` out of a task's `input`."
          );
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
    await owePass(ctx);
    try {
      await ref.addTask(init);
    } catch (error) {
      // Two routings of one post at once: the other's add landed first.
      if (ref.get(init.id) !== undefined) return "exists";
      throw error;
    }
    await triggerPass(ctx);
    return "filed";
  };

  return {
    board,
    roster,
    resolver,
    /**
     * The board as the worker's own turn files through it: the model's task
     * tools read it, and a step for itself goes on its plan ledger (FIX-2076).
     * `resolver` is the actions', which file no step.
     */
    turnResolver,
    runBoard,
    /**
     * A block that runs the board's pass through its entry, one at a time
     * (FIX-2078): for a door that wants the board run, never the pass inline.
     */
    triggerPass: handler({
      name: "conversation-board-trigger-pass",
      inputSchema: z.unknown(),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        await triggerPass(ctx as never);
        return {};
      }
    }),
    filePost,
    files,
    tools,
    /**
     * Wrap a turn (`{ message }` in, the answer out) so the steps it files for
     * itself are worked in its request, then answered once more (FIX-2076 D1,
     * D2). Wrap every turn the flow runs as the worker: its door, its task
     * entry's turn and the turn `entries` wakes. A worker is offered its steps
     * only on a flow that wraps one.
     */
    planned: planning.planned,
    /** The task tools as public actions, `<tool>_tasks`, `dispatchTask_tasks` among them. */
    actions: taskToolActions(CONVERSATION_LEDGER_ID, resolver, roster, { dispatches: true }),
    /** The ledger, the plan ledger and the chain records, for the flow's `resources`. */
    resources: { ...conversationLedgerResources, ...planLedgerResources, ...taskChainResources }
  };
}

export type ConversationBoard = ReturnType<typeof defineConversationBoard>;
