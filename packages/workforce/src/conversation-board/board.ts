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
 * - **The grant** (FIX-1802 D1, FIX-2081). A session's delegates are its
 *   authority: it files for the ones that take a task now, read on every
 *   call, server-side, and for no one else. Under `delegates: all` that is
 *   the user's whole roster as it stands (`../delegates`). A task session
 *   files its task's pieces, which its task then waits on (`./split`), for
 *   the same delegates. An unassigned row goes to the only one.
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
 * - **The tools and the actions.** Orchestration's task tools, on the
 *   model's turn and as public actions, over one resolver and one roster. The
 *   tools are one capability whose tools are on a turn only while the session
 *   files, read per call. The resolver is the running session's own board,
 *   and none while it doesn't file, so an action answers
 *   `no_delegation_board`. The roster is the session's delegates that take a
 *   task, read on every call. An edit is one guarded write
 *   (`patchSettings`), and an assignee it writes is checked here as a
 *   filing's is: a step's and a delegate's are filed apart.
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
 *   conversation, with one attempt. A task's session takes neither:
 *   `createTask` refuses them there, naming the setting.
 * - **A workstream's record** (FIX-2083). A delegate record with a target is a
 *   workstream its worker leads. A task for it names that target (`target`, a
 *   filing setting), and the filing resolves the workstream's session then,
 *   server-written on the row (`targetSessionId`): filed `session:
 *   "ongoing"`, the task runs there. A worker that is only a workstream here
 *   takes no task without its target, and a filer with no such record takes
 *   no target.
 * - **Routed tasks** (FIX-2083). A coordinator hands a user's message to a
 *   delegate as an ordinary task with the routing settings, carrying the
 *   message in its server-written brief: through
 *   {@link ConversationBoard.fileRouted} for a routing policy, and, on a turn
 *   routing a message, through any filing whose result goes to the
 *   conversation ({@link RoutedFiling}). Nothing else about it is special.
 * - **The pass** (FIX-2078). One run of the board, `dispatch`, one at a
 *   time per session (`defer`: a second waits its turn): repairs first
 *   (orchestration's `payBoardDebts`: cancels, cascades, resumes, notices past
 *   due; reports stored before the upgrade; the settles owed down the chain),
 *   then the drain, then the repairs again and a last ready check, before the
 *   session's wake moves to the next debt's due time or clears. That check
 *   reads this request's snapshot, so it can't see a concurrent write. What
 *   keeps such a debt is the wake's version: every writer that can make a row
 *   ready or end one (a filing, an assign, an answer, a release, a
 *   claim at its lease's end, an ending) owes the session's wake before it
 *   writes, which bumps the version, so the pass's settle comes back stale
 *   and the wake stays. Each then runs the pass. A touch of the board runs the
 *   pass only when something is startable or past due; it resends nothing.
 */
import {
  payBoardDebts,
  settlePassWake,
  taskToolsForTurn,
  taskToolActions,
  taskToolReads,
  type TaskCollectionResolver,
  type AssigneeRoster,
  type AssigneeRosterSource
} from "@flow-state-dev/orchestration";
import { afterTaskCheck, currentWorkerClaim, taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  TaskCapExceededError,
  TaskFilingRefusedError,
  TaskWriteRefusedError,
  assertDepsFileable,
  assertFilingCallerContext,
  assertFilingSettings,
  assertFollowUpHasRun,
  assertIdsFree,
  assertUniqueIds,
  hasStarted,
  isClaimable,
  isTerminalStatus,
  nextHoldDue,
  NOTICE_DUE_MS,
  noticeDueAt,
  filerResolver,
  resendNowPatch,
  type Task,
  type TaskCollectionRef,
  type ClaimOrder,
  type TaskInit,
  type TaskWriteOutcome
} from "@flow-state-dev/orchestration/tasks";
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import { carriedHopState, freshHopMark, heldFromFiling, hopMarkOf, sessionUserLinesOf, turnHopMark } from "../messages/hop";
import type { BlockContext, BlockDefinition, DispatchAddress } from "@flow-state-dev/core/types";
import { z } from "zod";
import { WORKER_TASK_ENTRY } from "../worker-task-entry";
import { soleTaskDelegate, type TaskDelegates } from "../delegates/worker-delegates";
import { delegateKey } from "../delegates/delegate-list";
import { resolveWorkstreamTarget } from "../projects/project-coordinator";
import { cancelIfParentEnded, refuseIfParentCancelled, stampFiledMarker } from "./cascade";
import {
  FILING_FLOW_STATE_KEY,
  FILING_WORKER_STATE_KEY,
  FILING_PROJECT_STATE_KEY,
  FILING_WORKSTREAM_STATE_KEY,
  FILING_SESSION_STATE_KEY,
  TASK_CHAIN_STATE_KEY,
  TASK_FLOW_STATE_KEY,
  TASK_ID_STATE_KEY,
  WORKER_ID_STATE_KEY
} from "../workers/keys";
import { FILED_HOP, FILED_PROJECT, PIECE_OF, DISPATCH_ENTRY } from "./board-entries";
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
import { projectAddressSchema } from "../projects/collections";
import { namesProject, SET_THE_FILERS_PROJECT } from "../projects/run-project";
import { parseProjectRef, projectRef, type ProjectAddressRef } from "../projects/workstream-ref";
import { filingProjectAddressOf, filingProjectOf, filingSessionIdOf, filingWorkstreamOf, stateBeforeWorkProject } from "./filing-session";
import {
  CONVERSATION_LEDGER_ID,
  callerMetadata,
  conversationLedger,
  CONVERSATION_BOARD_SETTINGS,
  conversationLedgerAt,
  conversationLedgerResources
} from "./ledger";
import { startOwedSteerTurn } from "./steer-turn-start";
import { holdRoutedSession, routedSessionResources, sessionsHeldElsewhere } from "./routed-session";
import { conversationDelivery } from "./delivery";
import { owedReports, sendLegacyReports } from "./report-owed";
import { filedProjectOf, filingProjectStampOf, isStamped, pieceOwnerOf } from "./held-task";
import { PLAN_LEDGER_ID, STEP_ATTEMPTS, definePlanning, isAnsweringTurn, isSteppingTurn, planLedgerAt, planLedgerResources } from "./plan";
import { verifiedWorkerOf } from "../workers/verified-worker";

/**
 * How many attempts a filed task gets: a failure with one left runs the task
 * again in the same session, with no coordinator turn, and the second failure
 * is the one the conversation hears.
 */
const TASK_ATTEMPTS = 2;

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
  /**
   * Whether the worker flow takes tasks through its own `work` entry, the one
   * a conversation hands tasks to: then a step it files for itself may run in
   * a new session of its own (`session: "new"`, FIX-2082 D2). Omitted, it
   * can't, and such a step is refused.
   */
  takesOwnTasks?: () => boolean;
  /** The most tasks under one top task, read on every filing. Omitted, {@link DEFAULT_TASK_CHAIN_LIMIT}. */
  chainLimit?: () => number | undefined;
  /**
   * Whether a delegate's flow works in a project's files (FIX-2333): a task
   * for it filed with no project to work in is refused `no_project` before
   * anything is reserved or written. Omitted, no flow needs one.
   */
  needsProject?: (flowKind: string) => boolean;
  /**
   * How a session that routes messages files a routed task from its model's
   * turn (FIX-2083): on a turn routing one, a filing whose result goes to the
   * conversation is handed here, which attaches the message and files it.
   */
  routes?: RoutedFiling;
  /**
   * The messages the session sent that are still owed (FIX-2240): the pass's
   * first half pays them, beside the plan ledger's debts, and its settle
   * keeps the next one's due time. `resources` are what the step reads.
   */
  messages?: {
    readonly resources: Record<string, unknown>;
    readonly payDebts: (ctx: BlockContext) => Promise<number | undefined>;
  };
}

/**
 * The routing half of a coordinator's board (FIX-2083), supplied by the layer
 * that knows what a routed message is. The board files nothing for it: `file`
 * files the routed task itself, through {@link ConversationBoard.fileRouted}.
 */
export interface RoutedFiling {
  /** Whether the running turn is routing a message it can hand on. */
  routing(ctx: BlockContext): boolean;
  /** Told to the turn's model, beside its task tools, on a turn routing a message. */
  readonly description: string;
  /**
   * File `init` as a routed task, its brief attached, and return its row:
   * checked as a filing is, so a refusal throws `TaskWriteRefusedError`.
   */
  file(ctx: BlockContext, init: TaskInit): Promise<Task>;
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

/**
 * The workstream rule for a row's assignee (FIX-2083): a row naming a target
 * goes only to the worker whose record names it; a row naming none goes to
 * no worker that is only a workstream here.
 *
 * @throws TaskWriteRefusedError naming the rule.
 */
function assertTargetFits(
  records: readonly { readonly worker: string; readonly target?: string }[],
  assignee: string | undefined,
  target: string | undefined,
  how: "filed" | "reassigned"
): void {
  if (assignee === undefined) return;
  const written = how === "filed" ? "Nothing was filed." : "Nothing was changed.";
  if (target !== undefined) {
    if (!records.some((record) => record.worker === assignee && record.target === target)) {
      throw new TaskWriteRefusedError(
        "target_not_a_delegate",
        `the task is for workstream "${target}", and "${assignee}" doesn't lead it here. ${written}`
      );
    }
    return;
  }
  const led = records.filter((record) => record.worker === assignee);
  if (led.length > 0 && led.every((record) => record.target !== undefined)) {
    throw new TaskWriteRefusedError(
      "target_required",
      `"${assignee}" leads ${led.length === 1 ? "a workstream" : "workstreams"} here (${led.map((record) => record.target).join(", ")}), ` +
        `so a task for it names one with target. ${written}`
    );
  }
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
    // The same default the guarded `createTask` gives an unassigned row: the
    // conversation's only task-taking delegate, or none.
    soleAssignee: () => soleTaskDelegate(delegates)
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

/** The refusal for a hold or a release of a step: the drain works a step in its request, and never waits on a held one. */
const stepNotHeld = (taskId: string) =>
  new TaskWriteRefusedError(
    "step_cannot_be_held",
    `task "${taskId}" is a step for yourself, and it runs in this request: it can't be held or released. ` +
      "File it for a delegate, held, instead. Nothing was written.",
    taskId
  );

/** The refusal for a wait on a step: it runs after the waiting turn, in its request (FIX-2082). */
const stepCannotWait = (taskId: string) =>
  new TaskWriteRefusedError(
    "step_cannot_wait",
    `task "${taskId}" is a step for yourself: it runs after this turn, in this request, so this turn can't wait on it. ` +
      "End the turn, and you hear how it ended when it has. Nothing was written.",
    taskId
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
 * The `session` setting of the row the board is handing over, and the
 * workstream session its filing resolved, read off the row on its own board
 * (FIX-2080, FIX-2083): server-written at filing, never input.
 */
async function sessionSettingOf(ctx: BlockContext, taskId: string): Promise<Pick<Task, "session" | "targetSessionId">> {
  const ref = await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
  const row = ref?.get(taskId);
  return {
    ...(row?.session !== undefined ? { session: row.session } : {}),
    ...(row?.targetSessionId !== undefined ? { targetSessionId: row.targetSessionId } : {})
  };
}

/**
 * The project a row filed here runs in (FIX-2161), as the stamp to write on
 * the row and the address to write over a project its input names, so a
 * guess is not refused `other-project`: a follow-up's root row's project,
 * then the session's own, then the one the filing inherits (a held task's
 * stamp in a delegate's ongoing session).
 */
async function filedProjectFor(ctx: BlockContext, root?: Task): Promise<{ stamp: string | null; own: ProjectAddressRef | undefined }> {
  if (root !== undefined && !isStamped(root)) {
    const legacy = legacyProjectOf(ctx.session.state, root);
    return { stamp: legacy === undefined ? null : projectRef(legacy), own: legacy };
  }
  const stamp = isStamped(root) ? (filedProjectOf(root) ?? null) : await filingProjectStampOf(ctx);
  const inherited = stamp === null ? undefined : parseProjectRef(stamp);
  const own = isStamped(root) ? inherited : (filingProjectAddressOf(ctx.session.state) ?? inherited);
  return { stamp, own };
}

/**
 * The project a row filed before rows carried the stamp was filed in
 * (FIX-2161): its conversation's as it stood then, before a user could set
 * one (`workProjectId`), else the one its input names, which its session's
 * run read. `undefined` for none.
 */
function legacyProjectOf(state: unknown, row: Pick<Task, "input">): ProjectAddressRef | undefined {
  const conversation = filingProjectAddressOf(stateBeforeWorkProject(state));
  if (conversation !== undefined) return conversation;
  const named = projectAddressSchema.safeParse((row.input as { project?: unknown } | null | undefined)?.project);
  return named.success ? named.data : undefined;
}

/**
 * The project a task's session is handed (FIX-2161): the one its row was
 * stamped with when it was filed, so a task waiting on the board keeps it
 * when its conversation's project changes; none for a row filed with none.
 * A row filed before rows carried the stamp is handed what it was handed
 * then, its conversation's project before a user could set one (BP-030).
 * Not the project its input names, as `legacyProjectOf` falls back to: the
 * run reads that one itself, and the task's session may already exist,
 * created with this value in its readonly `filingProjectId`, so handing a
 * follow-up any other would be refused.
 */
async function handedProjectOf(ctx: BlockContext, taskId: string): Promise<string | undefined> {
  const ref = await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
  const row = ref?.get(taskId);
  if (isStamped(row)) return filedProjectOf(row);
  return filingProjectOf(stateBeforeWorkProject(ctx.session.state));
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
 * a task's own session (its root's, for a follow-up), or, filed `session:
 * "ongoing"`, the delegate's ongoing session for the conversation, or the
 * workstream session its filing resolved (FIX-2083). A follow-up's row
 * carries its root's setting, so it keys where its root ran (FIX-2111).
 */
function sessionKeyOf(task: Pick<Task, "id" | "assignee" | "followUpOf" | "session" | "targetSessionId">): string | undefined {
  if (task.assignee === undefined) return undefined;
  if (task.session === "ongoing") {
    return task.targetSessionId !== undefined ? `id:${task.targetSessionId}` : `delegate:${delegateKey({ worker: task.assignee })}`;
  }
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
function isStartable(task: Task, rows: readonly Task[]): boolean {
  if (task.assignee === undefined) return false;
  const key = sessionKeyOf(task);
  if (key === undefined) return true;
  return !rows.some((other) => other.id !== task.id && holdsSession(other) && sessionKeyOf(other) === key && !queuedAfter(other, task));
}

/**
 * Whether `other`, a holder of `task`'s session, waits behind `task` instead
 * of blocking it. Two started rows can both be waiting on one session once a
 * retry reopens one (FIX-2383); each would block the other forever, so the
 * earlier-filed one runs first. A running holder always blocks.
 */
function queuedAfter(other: Task, task: Task): boolean {
  if (other.status !== "pending" || task.status !== "pending" || !hasStarted(task)) return false;
  return task.createdAt !== other.createdAt ? task.createdAt < other.createdAt : task.id < other.id;
}

/**
 * The sessions by id another board's routed task holds now, by board, as this
 * process last read them (`./routed-session`). A hint only, for the checks
 * that decide whether a pass is owed without a read of their own (a release,
 * a touch, the drain's exit): what starts a routed task is the claim's own
 * hold, written in one compare-and-swap on the session's record, never this.
 * Dropped once a board's read finds none held.
 */
const heldElsewhere = new Map<string, ReadonlySet<string>>();

const heldKeyOf = (collection: TaskCollectionRef): string => `${collection.collectionId}\u0000${collection.partition ?? ""}`;

/** Keep what a board's pass just read: the sessions held elsewhere, or none. */
function noteHeldElsewhere(collection: TaskCollectionRef, held: ReadonlySet<string>): void {
  if (held.size === 0) heldElsewhere.delete(heldKeyOf(collection));
  else heldElsewhere.set(heldKeyOf(collection), held);
}

/** Whether `task` would run in a session another board's routed task holds. */
function heldByAnotherBoard(task: Task, held: ReadonlySet<string> | undefined): boolean {
  return task.targetSessionId !== undefined && held?.has(task.targetSessionId) === true;
}

/**
 * Take each session by id a startable row here would start in (FIX-2083
 * rule 5 across boards): for each, the one row of this board that may start
 * there now, or none while another board's routed task holds it. The rows
 * for one session are taken earliest filed first; this board's own rule 5
 * starts one of them at a time anyway.
 */
async function takeTargetSessions(ctx: BlockContext, collection: TaskCollectionRef): Promise<ReadonlyMap<string, string | undefined>> {
  const now = collection.now();
  const lookup = (taskId: string): Task | undefined => collection.get(taskId);
  const rows = collection.list();
  const first = new Map<string, Task>();
  for (const task of rows) {
    const target = task.targetSessionId;
    if (target === undefined || (task.status !== "pending" && task.status !== "in_progress")) continue;
    if (!isStartable(task, rows) || !isClaimable(task, lookup, now)) continue;
    const seen = first.get(target);
    if (seen === undefined || task.createdAt < seen.createdAt) first.set(target, task);
  }
  const taken = new Map<string, string | undefined>();
  for (const [target, task] of first) taken.set(target, await holdRoutedSession(ctx, collection, target, task.id));
  return taken;
}

/**
 * Claims only rows that may start: an unassigned row, or one whose session is
 * busy, on this board or (a session by id) on another, waits on the board. A
 * row for a session by id is claimed only once this board holds that session
 * for it. A claimed row's filed hop count is kept until a user's line in the
 * filer's conversation ({@link keepFiledHopInChain}).
 */
const startableOnly: ClaimOrder = {
  claim: async (collection, workerId, ctx) => {
    const taken = await takeTargetSessions(ctx, collection);
    noteHeldElsewhere(collection, new Set([...taken].filter(([, id]) => id === undefined).map(([target]) => target)));
    const claimed = await collection.claim(workerId, {
      eligibility: (task, rows) =>
        isStartable(task, rows) && (task.targetSessionId === undefined || taken.get(task.targetSessionId) === task.id)
    });
    return claimed === null ? null : keepFiledHopInChain(ctx, collection, claimed);
  }
};

/**
 * At the claim, in the filer's own pass (FIX-2106): a row's filed hop count
 * (`FILED_HOP`) stands until a user's line in the filer's conversation. The
 * record keeps how many user's lines the filer's session had taken at the
 * filing; one more since, and the record is cleared, server-side, and the
 * task's turn runs as a row with none would: at its born-with count, which
 * is the filer's now, or its session's. A message from another chain that
 * moved the filer's session elsewhere is no user's line, and leaves it.
 */
async function keepFiledHopInChain(ctx: BlockContext, collection: TaskCollectionRef, task: Task): Promise<Task> {
  const mark = hopMarkOf(task.metadata?.[FILED_HOP]);
  if (mark === undefined || sessionUserLinesOf(ctx.session.state) <= mark.lines) return task;
  await collection.patchMetadata(task.id, { [FILED_HOP]: null });
  return collection.get(task.id) ?? task;
}

/**
 * A row held before its first start (FIX-2238): its filed mark becomes a
 * fresh chain, as {@link heldFromFiling}'s filing writes, keeping the filer's
 * user lines the mark counted. A started row's hold is midway, and keeps its
 * budget; a row with no mark runs at its session's count anyway.
 */
async function freshenFiledHop(ctx: BlockContext, collection: TaskCollectionRef, id: string): Promise<void> {
  const task = collection.get(id);
  const mark = hopMarkOf(task?.metadata?.[FILED_HOP]);
  if (task === undefined || mark === undefined || hasStarted(task)) return;
  await collection.patchMetadata(id, { [FILED_HOP]: { ...freshHopMark(ctx), lines: mark.lines } });
}

/** The filing session's worker, for a session the hand-over opens: where a message to it from there lands (FIX-2238). */
function filingWorkerOf(state: unknown): Record<string, string> {
  const worker = (state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
  return typeof worker === "string" && worker.length > 0 ? { [FILING_WORKER_STATE_KEY]: worker } : {};
}

/**
 * Whether a row this board can start is waiting: startable ({@link isStartable})
 * and claimable now (a dead run's row included). Such a row is owed a run of
 * the board; this is the whole of a start's debt (`./ledger`). With `id`, only
 * that row. A row for a session another board's routed task holds, as this
 * ledger's pass last read it, isn't, unless `heldToo`.
 */
function hasStartable(collection: TaskCollectionRef, id?: string, heldToo = false): boolean {
  const now = collection.now();
  const lookup = (taskId: string): Task | undefined => collection.get(taskId);
  const rows = collection.list();
  const held = heldToo ? undefined : heldElsewhere.get(heldKeyOf(collection));
  return rows.some(
    (task) =>
      (task.status === "pending" || task.status === "in_progress") &&
      (id === undefined || task.id === id) &&
      isStartable(task, rows) &&
      !heldByAnotherBoard(task, held) &&
      isClaimable(task, lookup, now)
  );
}

/**
 * A touch that starts what the board owes: the pass, when a row is startable
 * now (a follow-up whose session just freed included). Never fails the caller.
 */
export async function wakeIfStartable(ctx: BlockContext, collection: TaskCollectionRef): Promise<void> {
  if (hasStartable(collection)) await triggerPass(ctx, { touch: true });
}

/**
 * Owe the running session's pass a wake, due in seconds (FIX-2078): before a
 * write that owes a start, so a crash after the write leaves the debt a due
 * time. A host that keeps no wakes has the fast path only. Never fails.
 */
async function owePass(ctx: BlockContext): Promise<void> {
  try {
    await ctx.requestHost?.wakes?.owe({ entry: DISPATCH_ENTRY, dueAt: Date.now() + NOTICE_DUE_MS });
  } catch {
    // The fast path still runs.
  }
}

/**
 * The passes this process sent that haven't started, and the ones running, by
 * session, with when. A pass reads the board when it starts, after it waited
 * its turn, so:
 *
 * - **Any trigger skips while a pass waits to start**: that pass reads every
 *   write made before it starts, this one's included. Without this, a burst of
 *   filings lines up a pass each, run one after another.
 * - **A touch that found only startable rows also skips while one runs**: a
 *   touch writes nothing, and every write that made a row startable sent its
 *   own trigger after it, so the running pass read it, or a waiting one will.
 *   A write's trigger doesn't skip for a running pass, which may have read the
 *   board before it landed; nor does a touch that found a debt past due, which
 *   no write sends a pass for.
 *
 * Only where the pass runs in this process (`RequestHost.dispatchRunsHere`):
 * on a host whose passes run on a queue's worker, this process never sees one
 * start, so nothing is skipped there. A write skipped behind a pass that then
 * never starts is still paid: by the wake it owed first, or, on a host that
 * keeps none, by a trigger sent again once {@link PASS_START_GRACE_MS} lapses
 * with that pass still not started.
 *
 * Module state, unlike the pass's own read of its wake and its rounds, which
 * live in its request's state: this is a saving shared by the requests of one
 * process, not something a pass needs to be correct. A lost entry costs one
 * repeated pass; a stale one lapses.
 */
const waitingPasses = new Map<string, number>();
const runningPasses = new Map<string, number>();

/** How long a sent pass counts as waiting to start. */
const PASS_START_GRACE_MS = 5_000;

/** How long a started pass counts as running. */
const PASS_RUN_GRACE_MS = 30_000;

const waitingPassKey = (ctx: BlockContext): string =>
  `${(ctx.session.identity as { tenantId?: string }).tenantId ?? ""}\u0000${ctx.session.identity.id}`;

/**
 * Run the session's pass: dispatch `dispatch` into the running session, as
 * a request of its own, owing its wake first. Never waits for it, and never
 * fails the caller: while a pass runs it waits its turn (one at a time), and
 * past the line's cap the wake covers what it would have done. Skipped while a
 * pass this process sent waits to start, and a touch that found only startable
 * rows (`touch`) also while one runs (see {@link waitingPasses}).
 */
export async function triggerPass(ctx: BlockContext, options: { touch?: boolean } = {}): Promise<void> {
  await owePass(ctx);
  const key = waitingPassKey(ctx);
  const now = Date.now();
  const sent = waitingPasses.get(key);
  const running = runningPasses.get(key);
  const here = ctx.requestHost?.dispatchRunsHere === true;
  const waiting = here && sent !== undefined && now - sent < PASS_START_GRACE_MS;
  if (waiting) {
    // No wake backs this write: if that pass never starts, send again.
    if (options.touch !== true && ctx.requestHost?.wakes === undefined) resendIfNeverStarted(ctx, key, sent!);
    return;
  }
  if (here && options.touch === true && running !== undefined && now - running < PASS_RUN_GRACE_MS) return;
  waitingPasses.set(key, now);
  try {
    const outcome = await dispatchThroughSeam(ctx, {
      type: "internal",
      action: DISPATCH_ENTRY,
      session: { id: ctx.session.identity.id },
      payload: {},
      from: "conversation-board-wake"
    });
    if (!outcome.ok) await notSent(ctx, key, now);
  } catch {
    await notSent(ctx, key, now);
  }
}

/**
 * The pass sent at `sent` never went out (refused, or the send failed). The
 * next trigger tries again; and a write already skipped behind it on a host
 * that keeps no wakes, which no wake backs, gets that trigger now.
 */
async function notSent(ctx: BlockContext, key: string, sent: number): Promise<void> {
  if (waitingPasses.get(key) !== sent) return;
  waitingPasses.delete(key);
  const check = `${key}\u0000${sent}`;
  if (!resendChecks.has(check)) return;
  resendChecks.delete(check);
  await triggerPass(ctx);
}

/** The running session's pass has started: a write's trigger from here on asks for the next one. */
export function notePassStarted(ctx: BlockContext): void {
  const key = waitingPassKey(ctx);
  waitingPasses.delete(key);
  runningPasses.set(key, Date.now());
}

/** The running session's pass has ended. */
export function notePassEnded(ctx: BlockContext): void {
  runningPasses.delete(waitingPassKey(ctx));
}

/** Sends that will check, once the start grace lapses, that the pass sent at `sent` began. */
const resendChecks = new Set<string>();

/**
 * Once the pass sent at `sent` has had {@link PASS_START_GRACE_MS} to start,
 * send another if it still hasn't (its entry is unchanged): the backstop for a
 * write skipped behind it on a host that keeps no wakes. One check per pass.
 */
function resendIfNeverStarted(ctx: BlockContext, key: string, sent: number): void {
  const check = `${key}\u0000${sent}`;
  if (resendChecks.has(check)) return;
  resendChecks.add(check);
  const timer = setTimeout(() => {
    if (!resendChecks.delete(check)) return;
    if (waitingPasses.get(key) !== sent) return;
    waitingPasses.delete(key);
    void triggerPass(ctx).catch(() => undefined);
  }, Math.max(0, sent + PASS_START_GRACE_MS - Date.now()));
  (timer as { unref?: () => void }).unref?.();
}

/** Whether any debt on the board is past its due time: the touch runs the pass for it. */
function hasPastDue(rows: readonly Task[], now: number): boolean {
  return rows.some((row) => {
    const notice = noticeDueAt(row);
    if (notice !== undefined && notice <= now) return true;
    if (row.cascadeOwed != null && row.cascadeOwed.due <= now) return true;
    if ((row.resumeOwed === true || row.cancelOwed === true) && row.updatedAt + NOTICE_DUE_MS <= now) return true;
    // A held question past a deadline the host set (FIX-2133): the pass closes it.
    const held = nextHoldDue(row);
    if (held !== undefined && held <= now) return true;
    // A report owed by a row stored before FIX-2078: due at once (BP-030).
    return owedReports(row).length > 0;
  });
}

/** The most rounds of drain and repair one pass runs. */
const MAX_PASS_ROUNDS = 3;

/**
 * How long a routed task waits before its board looks again at a session
 * another board's routed task holds (FIX-2083): that board, not this one,
 * hears the holder end.
 */
const HELD_ELSEWHERE_RETRY_MS = 5_000;

/**
 * What one pass keeps between its steps, in its own request's state (so a
 * failed or aborted pass leaves nothing behind, and a pass resumed elsewhere
 * reads it back): the wake as read at its start, settled at its end against
 * that version, the rounds run so far, and when the plan ledger's next debt
 * falls due (a resume owed to a drain parked on a step in its own session),
 * which the settle keeps. Correctness rests on this. The
 * process-wide record of passes sent and running ({@link notePassStarted})
 * is only a saving, and lives in module state for that reason.
 */
const passStateSchema = z.object({
  passWake: z.object({ dueAt: z.number(), landBy: z.number(), version: z.number() }).optional(),
  passRounds: z.number().optional(),
  passPlanDue: z.number().optional(),
  passMessagesDue: z.number().optional()
});
type PassState = z.infer<typeof passStateSchema>;
const passStateOf = (ctx: BlockContext): PassState => (ctx.request.state ?? {}) as PassState;

/**
 * Build a conversation's task board and everything a flow carrying it
 * declares: the drain behind the run entry, the tools for the model's turn,
 * the actions, and the ledger.
 */
export function defineConversationBoard(options: ConversationBoardOptions) {
  /**
   * Who a filing in the running session can name, read now: its delegates
   * that take a task (under `delegates: all`, the roster as it stands), in a
   * task session as in a conversation (FIX-2081). Server-side only: the
   * delegate list is server-written state, never input. Not memoized across
   * calls, so a hire or a removal counts on the next one (D2).
   */
  const reach = (ctx: BlockContext): Promise<TaskDelegates> => options.delegates(ctx);

  /** The roster the task tools and actions check an assignee against: the delegates. */
  const roster: AssigneeRosterSource = async (ctx) => rosterOf(await reach(ctx));

  /**
   * Whether the running session files for a delegate now (FIX-1802 D1): one
   * of its delegates takes a task, read from its list as it stands. A worker
   * that works steps files them whatever its delegates (`turnFiles`).
   */
  const files = async (ctx: BlockContext): Promise<boolean> => (await reach(ctx)).available.size > 0;

  /**
   * The hand-over of a step filed `session: "new"` (FIX-2082 D2): to the
   * worker's own `work` entry, in a session keyed by the step and the worker,
   * born naming the worker, the conversation its steps are filed in, this
   * flow, the step, and its place in the chain, one board deeper. All
   * server-written: the claim the plan board took, and this session's state.
   */
  const stepAddress: DispatchAddress = {
    type: "task",
    action: WORKER_TASK_ENTRY,
    session: {
      by: async (task) => ({ key: taskSessionKey(task.taskId, task.assignee) })
    },
    state: async (task, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      const workstream = filingWorkstreamOf(ctx.session.state);
      // The session's project, or, in a delegate's ongoing session, the held task's (FIX-2161).
      const project = (await filingProjectStampOf(ctx)) ?? undefined;
      return {
        [WORKER_ID_STATE_KEY]: task.assignee,
        [FILING_SESSION_STATE_KEY]: partition,
        [FILING_FLOW_STATE_KEY]: options.flowKind,
        ...filingWorkerOf(ctx.session.state),
        [TASK_ID_STATE_KEY]: task.taskId,
        [TASK_CHAIN_STATE_KEY]: chainOfFiling(ctx, partition, task.taskId).birth,
        ...carriedHopState(ctx.session.state),
        [TASK_FLOW_STATE_KEY]: options.flowKind,
        ...(workstream === undefined ? {} : { [FILING_WORKSTREAM_STATE_KEY]: workstream }),
        ...(project === undefined ? {} : { [FILING_PROJECT_STATE_KEY]: project })
      };
    }
  };
  const stepToOwnSession = markDispatcher(
    handler({
      name: "plan-step-dispatch",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("A step's hand-over runs through its plan board, never on its own.");
      }
    }),
    stepAddress
  );

  /** The flow's planning: its turns, wrapped so the steps they file run in their request (FIX-2076). */
  /**
   * After a request worked its plan and answered (FIX-2113): the notices this
   * session turned away while that turn waited on its own step
   * (`anotherTurnWaitsOnItsPlan`) are sent now, past their backoff, by the
   * session's pass. After the task's check, so they run after this turn,
   * one turn at a time.
   */
  const sendWaitingNotices = handler({
    name: "conversation-plan-send-waiting-notices",
    inputSchema: z.unknown(),
    resources: { ...conversationLedgerResources },
    execute: async (_input, ctx) => {
      await afterTaskCheck(ctx as never, async () => {
        const own = await conversationLedgerAt(ctx as never, await filingSessionIdOf(ctx.session));
        const owed = (own?.list() ?? []).filter((row) => noticeDueAt(row) !== undefined);
        if (own === undefined || owed.length === 0) return;
        for (const row of owed) {
          const patch = resendNowPatch(row);
          if (Object.keys(patch).length > 0) await own.patchMetadata(row.id, patch);
        }
        await triggerPass(ctx as never);
      });
    }
  });

  const planning = definePlanning({ newSession: stepToOwnSession, afterPlan: sendWaitingNotices });

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
  const address: DispatchAddress = {
    type: "task",
    // Every row, a routed task's included, goes to `work`.
    action: WORKER_TASK_ENTRY,
    session: {
      // The board's dispatch computes it while the claim it took is still on
      // its worker body's state: the assignee is the one the row was claimed
      // with, which the board freezes while an attempt holds it.
      by: async (task, ctx) => {
        const claim = claimOf(ctx);
        const worker = claim?.assignee;
        if (worker === undefined) {
          throw new Error(`Task "${task.taskId}" names no delegate, so it has no session to run in.`);
        }
        // A task filed `session: "ongoing"` runs in the delegate's session for
        // this conversation (FIX-2080), or in the workstream session its
        // filing resolved (FIX-2083), read off the row the board claimed.
        const setting = await sessionSettingOf(ctx, task.taskId);
        if (setting.session === "ongoing") {
          return setting.targetSessionId !== undefined
            ? { id: setting.targetSessionId }
            : { key: `delegate:${delegateKey({ worker })}` };
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
    flowKind: async (task, ctx) => {
      const reachable = await reach(ctx);
      const flow = reachable.available.get(task.assignee);
      if (flow !== undefined) return flow;
      const why = reachable.unavailable.get(task.assignee) ?? "it isn't one of this session's delegates";
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
    // filed from one) passes the project down the same way. A workstream's
    // session, by id, is never created.
    state: async (task, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      const flow = (await reach(ctx)).available.get(task.assignee);
      // The delegate's ongoing session for the conversation works no one
      // task (FIX-2080): born naming its worker, the worker, conversation and
      // flow that filed into it, and no task or task-chain place. It counts
      // its messages on in its filer's budget (FIX-2238), so its notices,
      // steers and posts never start a fresh one. One that exists keeps its
      // own state.
      if ((await sessionSettingOf(ctx, task.taskId)).session === "ongoing") {
        return {
          [WORKER_ID_STATE_KEY]: task.assignee,
          [FILING_SESSION_STATE_KEY]: partition,
          [FILING_FLOW_STATE_KEY]: options.flowKind,
          ...filingWorkerOf(ctx.session.state),
          ...carriedHopState(ctx.session.state),
          ...(flow !== undefined ? { [TASK_FLOW_STATE_KEY]: flow } : {})
        };
      }
      // The session's task: a follow-up's root, though the root's own
      // hand-over has already opened it, so this is only ever the root.
      const taskId = claimOf(ctx)?.followUpOf ?? task.taskId;
      const workstream = filingWorkstreamOf(ctx.session.state);
      const project = await handedProjectOf(ctx, taskId);
      return {
        [WORKER_ID_STATE_KEY]: task.assignee,
        [FILING_SESSION_STATE_KEY]: partition,
        [FILING_FLOW_STATE_KEY]: options.flowKind,
        ...filingWorkerOf(ctx.session.state),
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
    claimOrder: startableOnly,
    // Exit once nothing this run can start is waiting. An unassigned row
    // waits on the board for `updateTask({ assignee })`, so a run must not wait on it.
    onIdle: "wait",
    shouldExit: (collection) => !hasStartable(collection)
  });

  /**
   * The chain's half of a filing, shared by a task for a delegate and a step:
   * the row's id, minted now so its place is reserved first, and its entry
   * reserved under the chain's top. A filing that opens a session (a task for
   * a delegate) is refused one board past the deepest; a step opens none, so
   * it adds no depth and skips that check. Call `markAdded` once the add lands.
   */
  const reserveFiling = async (
    ctx: BlockContext,
    ledger: TaskCollectionRef,
    partition: string,
    init: TaskInit,
    opensSession: boolean
  ): Promise<{ id: string; markAdded: () => Promise<void> }> => {
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
    return { id, markAdded: async () => (top === undefined ? undefined : markAddedInChain(ctx, top, [entry])) };
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
     * batch runs these for every row before its first add, and passes its
     * rows as `filedWith`: a follow-up's root filed in the same batch has
     * never run.
     */
    const checkFiling = (init: TaskInit, filedWith?: ReadonlyMap<string, TaskInit & { id: string }>): void => {
      if (self !== undefined && init.assignee === self) throw stepFromItsOwnTurn(self);
      assertFilingCallerContext(init, { fromTaskSession });
      assertFilingSettings(init, CONVERSATION_BOARD_SETTINGS, ref.collectionId);
      assertFollowUpHasRun(init, (id) => filedWith?.get(id) ?? ref.get(id));
    };
    /**
     * A workstream's record (FIX-2083): a task naming a target names one of
     * the filer's records with it; a worker that is only a workstream here
     * takes no task without one. Then the target's session, resolved now and
     * written on the row, server-side. Read per filing, from the list as it
     * stands.
     */
    const withTarget = async (init: TaskInit): Promise<TaskInit> => {
      // A follow-up runs where its root ran, and the ledger writes the root's
      // workstream on it (FIX-2111): there is no target to choose or resolve.
      if (init.followUpOf !== undefined) return init;
      const { records } = await reach(ctx);
      // The assignee the row will have: the one named, or the one the board
      // gives a row with none (the conversation's only task-taking delegate).
      const assignee = init.assignee ?? (await soleDelegate());
      if (init.target === undefined) {
        assertTargetFits(records, assignee, undefined, "filed");
        return init;
      }
      if (!records.some((record) => record.target !== undefined)) {
        throw new TaskWriteRefusedError(
          "target_unavailable",
          `target names a workstream a delegate leads here, and none of this conversation's delegates leads one. Leave target out. Nothing was filed.`
        );
      }
      if (assignee === undefined || !records.some((record) => record.worker === assignee && record.target === init.target)) {
        throw new TaskWriteRefusedError(
          "target_not_a_delegate",
          `no delegate here is "${assignee ?? "(no assignee)"}" for workstream "${init.target}". ` +
            `Read your delegates with listDelegates, and name an assignee with the target its record names. Nothing was filed.`
        );
      }
      const resolved = await resolveWorkstreamTarget(ctx as never, { worker: assignee, target: init.target });
      if ("problem" in resolved) {
        throw new TaskWriteRefusedError("target_unreachable", `workstream "${init.target}" can't take it now: ${resolved.problem}. Nothing was filed.`);
      }
      return { ...init, assignee, targetSessionId: resolved.sessionId };
    };
    /**
     * A task for a delegate whose flow works in a project's files, filed with
     * no project to work in, is refused here, before anything is reserved or
     * written (FIX-2333), so the app can ask for a project before a task
     * exists. A project is the filer's workstream; a `target`'s (a target
     * names a workstream a delegate leads, which `withTarget` has already
     * resolved, and a workstream is always in a project); the one the row
     * would be stamped with (a follow-up's root's); or one the task names,
     * whose shape and existence the run checks. The same order as the run's
     * own lookup (`runProjectOf`), whose `no-project` stays the backstop: a
     * change to one belongs in the other.
     */
    const assertProjectFor = async (init: TaskInit): Promise<void> => {
      if (options.needsProject === undefined || init.target !== undefined) return;
      // A follow-up runs where its root ran, with its worker and its target (`withFollowUpPlacement`).
      const named = init.followUpOf === undefined ? undefined : ref.get(init.followUpOf);
      const root = named?.followUpOf === undefined ? named : ref.get(named.followUpOf);
      if (root?.target !== undefined) return;
      const assignee = root?.assignee ?? init.assignee ?? (await soleDelegate());
      const flow = assignee === undefined ? undefined : (await reach(ctx)).available.get(assignee);
      if (flow === undefined || !options.needsProject(flow)) return;
      if (filingWorkstreamOf(ctx.session.state) !== undefined) return;
      if ((await filedProjectFor(ctx, named)).stamp !== null) return;
      if (namesProject(init.input)) return;
      throw new TaskWriteRefusedError(
        "no_project",
        `"${assignee}" works in a project's files, and this conversation has no project for it to work in. Nothing was filed. ${SET_THE_FILERS_PROJECT}`
      );
    };
    /** The conversation's only task-taking delegate, which a row filed with no assignee goes to; none with none or several. */
    const soleDelegate = async (): Promise<string | undefined> => {
      return soleTaskDelegate(await options.delegates(ctx));
    };
    /**
     * A reassign (`setAssignee`) keeps the row's workstream rule (FIX-2083): a row naming a
     * target goes only to that target's lead, and a row naming none to no
     * worker that is only a workstream here.
     */
    const assertReassignable = async (id: string, assignee: string): Promise<void> => {
      const row = ref.get(id);
      if (row === undefined || row.assignee === assignee) return;
      const { records } = await reach(ctx);
      assertTargetFits(records, assignee, row.target, "reassigned");
    };
    /**
     * In a task session, refuse a filing once the task it would be a piece of
     * is cancelled (FIX-2129), before anything is reserved or written.
     */
    const refuseUnderCancelledTask = async (): Promise<void> => {
      const owner = await pieceOwnerOf(ctx);
      if (owner !== undefined) await refuseIfParentCancelled(ctx, owner, conversationLedgerAt);
    };
    /** Add one checked row under its chain reservation. */
    const fileReserved = async (init: TaskInit, reserved: { id: string; markAdded: () => Promise<void> }): Promise<Task> => {
      const { id, markAdded } = reserved;
      let assignee = init.assignee;
      if (assignee === undefined) {
        // An unassigned task goes to the conversation's only delegate; with
        // none or several it waits on the board until it is assigned.
        assignee = soleTaskDelegate(await options.delegates(ctx));
      }
      // In a task session, the row is a piece of the task it was filed for:
      // server-written, so the task's cascade reaches only its own pieces.
      const owner = await pieceOwnerOf(ctx);
      const given = callerMetadata(init.metadata);
      // A follow-up runs in its root's session, so it keeps the root's
      // project even after the conversation's changes (FIX-2161).
      const root = init.followUpOf === undefined ? undefined : ref.get(init.followUpOf);
      const { stamp: project, own } = await filedProjectFor(ctx, root);
      // The filing turn's hop count, which the task's turn starts at
      // (FIX-2106); a task held from its filing starts a fresh chain (FIX-2238).
      const metadata = {
        ...(given ?? {}),
        ...(owner === undefined ? {} : { [PIECE_OF]: owner }),
        [FILED_HOP]: heldFromFiling(init) ? freshHopMark(ctx) : turnHopMark(ctx),
        [FILED_PROJECT]: project
      };
      const input = ownProjectIn(init.input, own);
      // The task this piece is for learns where its session is first, so its
      // ending's cascade can reach the piece (FIX-2080 D2).
      if (owner !== undefined) await stampFiledMarker(ctx, owner, conversationLedgerAt);
      // A start owed has a due time before the row exists (FIX-2078).
      await owePass(ctx);
      const added = await ref.createTask({
        ...init,
        ...(input !== undefined ? { input } : {}),
        id,
        // A conversation-result task has one attempt (FIX-2080).
        maxAttempts: init.maxAttempts ?? (init.resultTo === "conversation" ? 1 : TASK_ATTEMPTS),
        ...(assignee !== undefined ? { assignee } : {}),
        metadata,
        // The task this piece is for, server-written (FIX-2081): `listTasks({ filedByTask })` reads it.
        ...(owner !== undefined ? { filedByTask: owner } : {})
      });
      await markAdded();
      if (owner !== undefined && (await cancelIfParentEnded(ctx, owner, ref, added.id, conversationLedgerAt))) {
        return ref.get(added.id) ?? added;
      }
      if (added.status !== "held" && isStartable(added, ref.list())) await triggerPass(ctx);
      return added;
    };
    const createTask: TaskCollectionRef["createTask"] = async (filing) => {
      // A caller never writes the session a target resolved to.
      const { targetSessionId: _resolved, ...init } = filing;
      checkFiling(init);
      // On a turn routing a message, a filing whose result goes to the
      // conversation is a routed task: its layer attaches the message.
      // One at a time: a batch on such a turn files plain tasks.
      if (init.resultTo === "conversation" && options.routes?.routing(ctx) === true) return options.routes.file(ctx, init);
      const targeted = await withTarget(init);
      await assertProjectFor(targeted);
      await refuseUnderCancelledTask();
      return fileReserved(targeted, await reserveFiling(ctx, ref, partition, targeted, true));
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
    /** A write that may end a top task: its chain's count goes with it. */
    const ending =
      (write: (id: string, ...rest: any[]) => Promise<TaskWriteOutcome>) =>
      async (id: string, ...rest: any[]): Promise<TaskWriteOutcome> => {
        const before = ref.get(id);
        const last = rest.length - 1;
        const args = last >= 0 && rest[last] !== null && typeof rest[last] === "object" ? [...rest.slice(0, last), ownClaim(rest[last])] : rest;
        const outcome = await write(id, ...args);
        // A top task ended here takes its chain's count with it.
        const after = ref.get(id);
        if (taskChainOf(ctx) === undefined && after !== undefined && isTerminalStatus(after.status) && before?.status !== after.status) {
          await deleteChain(ctx, { partition, taskId: id });
        }
        return outcome;
      };
    /**
     * After an answer or a deadline closed a question on `id`: a running row
     * that now owes its turn has that turn started in its session (a wake,
     * FIX-2086's steer turn), and a row now startable starts the board, whose
     * claim takes either. Whichever claims first wins (FIX-2133 D3).
     */
    const goOnAfterAnswer = async (id: string): Promise<void> => {
      const after = ref.get(id);
      if (after?.turnOwed === true && after.assignee !== undefined) {
        await startOwedSteerTurn(ctx, after, (await reach(ctx)).available.get(after.assignee));
      }
      if (hasStartable(ref, id)) await triggerPass(ctx);
    };
    return {
      ...ref,
      createTask,
      complete: ending(ref.complete.bind(ref)) as TaskCollectionRef["complete"],
      fail: ending(ref.fail.bind(ref)) as TaskCollectionRef["fail"],
      cancel: ending(ref.cancel.bind(ref)) as TaskCollectionRef["cancel"],
      // A release or a settings change that leaves a row startable starts the board.
      async release(id) {
        await owePass(ctx);
        const outcome = await ref.release(id);
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      // A retry (FIX-2383) leaves the row waiting again: one now startable starts the board, as a release does.
      ...(ref.retry === undefined
        ? {}
        : {
            async retry(id: string) {
              await owePass(ctx);
              const outcome = await ref.retry!(id);
              if (outcome.outcome === "recorded" && hasStartable(ref, id)) await triggerPass(ctx);
              return outcome;
            }
          }),
      // A steer (FIX-2086), a routed task's included (FIX-2083): one that
      // leaves the task waiting on it (it ran nothing, waiting on its filed
      // work) starts the turn it is owed, in the task's session.
      ...(ref.steer === undefined
        ? {}
        : {
            async steer(id: string, steer: Parameters<NonNullable<TaskCollectionRef["steer"]>>[1]) {
              const outcome = await ref.steer!(id, steer);
              const after = ref.get(id);
              if (outcome.outcome === "recorded" && after?.keptOpenBy === "steer" && after.assignee !== undefined) {
                await startOwedSteerTurn(ctx, after, (await reach(ctx)).available.get(after.assignee));
              }
              return outcome;
            }
          }),
      // An answer (FIX-2133): the last one lets the work go on. A task that
      // hasn't started is startable, which starts the board; a running one
      // owes its next turn on the same attempt, which the claim takes (D3),
      // and the turn's own start in its session only takes it sooner.
      ...(ref.answer === undefined
        ? {}
        : {
            async answer(id: string, answer: Parameters<NonNullable<TaskCollectionRef["answer"]>>[1]) {
              await owePass(ctx);
              const outcome = await ref.answer!(id, answer);
              if (outcome.outcome === "recorded") await goOnAfterAnswer(id);
              return outcome;
            }
          }),
      ...(ref.payHoldDeadlines === undefined
        ? {}
        : {
            async payHoldDeadlines() {
              const paid = await ref.payHoldDeadlines!();
              // Only the rows whose questions just closed go on.
              for (const id of paid) await goOnAfterAnswer(id);
              return paid;
            }
          }),
      // The one guarded edit (FIX-2080, FIX-2081): the field table holds inside
      // the write. An assignee is a delegate, never the worker itself;
      // metadata keeps its server-written keys. An edit that leaves a row
      // startable starts the board.
      async patchSettings(id, patch) {
        if (self !== undefined && patch.assignee === self) throw filedApart(id);
        const metadata = patch.metadata === undefined ? undefined : (callerMetadata(patch.metadata) ?? {});
        await owePass(ctx);
        const outcome = await ref.patchSettings(id, metadata === undefined ? patch : { ...patch, metadata });
        // Held before its first start, a task is held from its filing: released,
        // it starts a fresh chain, as one filed held does (FIX-2238).
        if (outcome.outcome !== "declined" && patch.held === true) await freshenFiledHop(ctx, ref, id);
        if (outcome.outcome !== "declined" && hasStartable(ref, id)) await triggerPass(ctx);
        return outcome;
      },
      async createTasks(inits) {
        // A refused batch files nothing (FIX-2080): every row's checks, the
        // batch's ids (unique, and none already filed), its dependencies (its
        // own ids count) and every row's place in the chain come first. A
        // reservation a later refusal strands lapses with its lease. Then each
        // row is added after the rows it depends on.
        assertUniqueIds(inits);
        assertIdsFree(inits, (id) => ref.get(id));
        // A caller never writes the session a target resolved to.
        const unresolved = inits.map(({ targetSessionId: _resolved, ...init }) => ({ ...init, id: init.id ?? newTaskId() }));
        const ordered = dependencyOrder(unresolved);
        const filedWith = new Map(ordered.map((init) => [init.id, init]));
        for (const init of ordered) checkFiling(init, filedWith);
        const batch: Array<TaskInit & { id: string }> = [];
        for (const init of ordered) batch.push({ ...(await withTarget(init)), id: init.id });
        for (const init of batch) await assertProjectFor(init);
        // As stored now, so one another request ended is refused before reserveFiling (FIX-2114).
        // A backing with no `refresh` must serve `get` committed across requests.
        const filed = new Set(batch.map((init) => init.id));
        for (const depId of new Set(batch.flatMap((init) => init.deps ?? []))) {
          if (!filed.has(depId)) await ref.refresh?.(depId);
        }
        assertDepsFileable(batch, (id) => ref.get(id));
        await refuseUnderCancelledTask();
        const reserved: Array<{ id: string; markAdded: () => Promise<void> }> = [];
        for (const init of batch) reserved.push(await reserveFiling(ctx, ref, partition, init, true));
        const added: Task[] = [];
        for (const [i, init] of batch.entries()) added.push(await fileReserved(init, reserved[i]!));
        return added;
      },
      async setAssignee(id, assignee) {
        if (self !== undefined && assignee === self) throw filedApart(id);
        await assertReassignable(id, assignee);
        await owePass(ctx);
        const outcome = await ref.setAssignee(id, assignee);
        // `unchanged` too: an assign retried after a lost wake starts the row.
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
      if (init.followUpOf !== undefined) {
        throw new TaskWriteRefusedError(
          "step_follows_nothing",
          "a step for yourself runs here, in this request, and follows up no task. File it without followUpOf. Nothing was filed."
        );
      }
      // A step runs here, or, filed `session: "new"`, in a new session of this
      // worker (FIX-2082 D2): never in an ongoing one.
      if (init.session === "ongoing") {
        throw new TaskWriteRefusedError(
          "step_session_ongoing",
          'a step for yourself runs in this session, or, filed session: "new", in a new session of yours: never in an ongoing one. Nothing was filed.'
        );
      }
      if (init.session === "new" && options.takesOwnTasks?.() !== true) {
        throw new TaskWriteRefusedError(
          "step_session_new_unsupported",
          'a step filed session: "new" runs in a new session of yours, through the entry your flow takes tasks through, and your flow declares none. File it without session to run it here. Nothing was filed.'
        );
      }
      // A step runs in this request, after this turn, so nothing would answer
      // one filed on questions (FIX-2133), as nothing would release one held.
      if (init.questions !== undefined && init.questions.length > 0) {
        throw new TaskWriteRefusedError(
          "step_cannot_hold_questions",
          "a step for yourself runs after this turn, in this request, so it can't wait on the user's answers. Ask them in your answer, or file the task for a delegate with its questions. Nothing was filed."
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
    /** Add one checked step under its chain reservation. */
    const fileReservedStep = async (init: TaskInit, reserved: { id: string; markAdded: () => Promise<void> }): Promise<Task> => {
      const { id, markAdded } = reserved;
      const metadata = callerMetadata(init.metadata);
      // The project the step's own session is handed, so a guess in its input
      // matches it (FIX-2161).
      const input = ownProjectIn(init.input, (await filedProjectFor(ctx)).own);
      // A step a task session plans is that task's, server-written (FIX-2081).
      const owner = await pieceOwnerOf(ctx);
      const added = await plan.createTask({
        ...init,
        ...(input !== undefined ? { input } : {}),
        ...(owner !== undefined ? { filedByTask: owner } : {}),
        id,
        assignee: self,
        maxAttempts: init.maxAttempts ?? STEP_ATTEMPTS,
        ...(metadata !== undefined ? { metadata } : {})
      });
      await markAdded();
      return added;
    };
    const fileStep: TaskCollectionRef["createTask"] = async (init) => {
      checkStep(init);
      // A step in a session of its own is one board deeper (FIX-2082 D2).
      return fileReservedStep(init, await reserveFiling(ctx, plan, partition, init, init.session === "new"));
    };
    /**
     * Each ledger resolves `deps` only among its own rows, so a dep on the
     * other ledger would never be met: neither a step waiting on a delegate's
     * task nor a delegate's task waiting on a step would ever start. Refused
     * at filing, before anything is written.
     */
    const depsOnOneLedger = (init: TaskInit, step: boolean, otherInBatch: ReadonlySet<string> = new Set()): void => {
      const other = step ? board : plan;
      const across = (init.deps ?? []).filter((dep) => other.get(dep) !== undefined || otherInBatch.has(dep));
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
    const createTask: TaskCollectionRef["createTask"] = async (init) => {
      const step = isStepFiling(init);
      depsOnOneLedger(init, step);
      return step ? fileStep(init) : board.createTask(init);
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
      <K extends "complete" | "fail">(method: K) =>
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
      createTask,
      async createTasks(inits) {
        // A refused batch files nothing (FIX-2080). Before the first add: the
        // batch's ids (unique, and none already on either ledger), each row's
        // ledger (the batch's rows for the other ledger count), and for the
        // steps everything the plan ledger's own add would check (the step
        // rules, the settings, the dependencies, where the batch's steps
        // count) and every step's place in the chain. The delegates' tasks go
        // to the board as one batch, which checks them whole before its first
        // add; then the steps are added, each after the steps it depends on.
        // A reservation a later refusal strands lapses with its lease.
        assertUniqueIds(inits);
        assertIdsFree(inits, (id) => plan.get(id) ?? board.get(id));
        const batch = inits.map((init) => ({ ...init, id: init.id ?? newTaskId() }));
        const stepIds = new Set(batch.filter(isStepFiling).map((init) => init.id));
        const taskIds = new Set(batch.filter((init) => !isStepFiling(init)).map((init) => init.id));
        for (const init of batch) {
          const step = isStepFiling(init);
          depsOnOneLedger(init, step, step ? taskIds : stepIds);
          if (step) checkStep(init);
        }
        const stepInits = dependencyOrder(batch.filter(isStepFiling));
        for (const init of stepInits) assertFilingSettings(init, undefined, plan.collectionId);
        assertDepsFileable(stepInits, (id) => plan.get(id));
        const reserved: Array<{ id: string; markAdded: () => Promise<void> }> = [];
        for (const init of stepInits) reserved.push(await reserveFiling(ctx, plan, partition, init, init.session === "new"));
        const tasks = await board.createTasks(batch.filter((init) => !isStepFiling(init)));
        const steps: Task[] = [];
        for (const [i, init] of stepInits.entries()) steps.push(await fileReservedStep(init, reserved[i]!));
        const byId = new Map([...tasks, ...steps].map((row) => [row.id, row]));
        return batch.map((init) => byId.get(init.id)!);
      },
      // Merged reads rely on task ids being unique across the two ledgers: both mint `task_<random>` ids.
      get: (id) => board.get(id) ?? plan.get(id),
      list: (filter) => [...board.list(filter), ...plan.list(filter)],
      count: (filter) => board.count(filter) + plan.count(filter),
      complete: notOnAStep("complete") as TaskCollectionRef["complete"],
      fail: notOnAStep("fail") as TaskCollectionRef["fail"],
      cancel: byRow("cancel") as TaskCollectionRef["cancel"],
      // The drain works a step in this request and doesn't wait on a held one.
      async hold(id) {
        if (isStep(id)) throw stepNotHeld(id);
        return board.hold(id);
      },
      release: byRow("release") as TaskCollectionRef["release"],
      ...(board.retry === undefined ? {} : { retry: byRow("retry") as NonNullable<TaskCollectionRef["retry"]> }),
      // A step runs after this turn, in this request: a wait on it would never end.
      ...(board.markWait === undefined
        ? {}
        : {
            async markWait(id: string, slot: Parameters<NonNullable<TaskCollectionRef["markWait"]>>[1]) {
              if (isStep(id)) throw stepCannotWait(id);
              return board.markWait!(id, slot);
            }
          }),
      ...(board.refresh === undefined && plan.refresh === undefined
        ? {}
        : {
            async refresh(id: string) {
              await board.refresh?.(id);
              await plan.refresh?.(id);
            }
          }),
      // A question is answered on the ledger holding its row (FIX-2133).
      ...(board.answer === undefined ? {} : { answer: byRow("answer") as NonNullable<TaskCollectionRef["answer"]> }),
      ...(board.ask === undefined ? {} : { ask: byRow("ask") as NonNullable<TaskCollectionRef["ask"]> }),
      // A step takes no message: its task's steers reach it (FIX-2086).
      async steer(id, steer) {
        if (isStep(id)) {
          throw new TaskWriteRefusedError(
            "step_takes_no_message",
            `task "${id}" is a step of the task its worker is running: steer the task this step belongs to. Nothing was written.`,
            id
          );
        }
        if (board.steer === undefined) return { outcome: "declined", reason: "disallowed", status: board.get(id)?.status ?? "pending" };
        return board.steer(id, steer);
      },
      setPriority: byRow("setPriority") as TaskCollectionRef["setPriority"],
      addLabel: byRow("addLabel") as TaskCollectionRef["addLabel"],
      removeLabel: byRow("removeLabel") as TaskCollectionRef["removeLabel"],
      patchMetadata: async (id, patch) => holder(id).patchMetadata(id, callerMetadata(patch) ?? {}),
      async setAssignee(id, assignee) {
        // A step is the worker's, and a delegate's task a delegate's: the two are filed apart.
        if (isStep(id) !== (assignee === self)) throw filedApart(id);
        return holder(id).setAssignee(id, assignee);
      },
      async patchSettings(id, patch) {
        // A step is the worker's, and a delegate's task a delegate's: the two are filed apart.
        if (patch.assignee !== undefined && isStep(id) !== (patch.assignee === self)) throw filedApart(id);
        if (!isStep(id)) return board.patchSettings(id, patch);
        // The drain works a step in this request and doesn't wait on a held one, in any state.
        if (patch.held !== undefined) throw stepNotHeld(id);
        const metadata = patch.metadata === undefined ? undefined : (callerMetadata(patch.metadata) ?? {});
        return plan.patchSettings(id, metadata === undefined ? patch : { ...patch, metadata });
      },
    };
  };

  /**
   * The board as `routesSelf`'s caller reaches it, after its touch: the
   * session's own board, guarded, with its steps beside it when the worker
   * works steps (FIX-2076). `undefined` while the caller may file nothing.
   */
  const reachBoard = async (ctx: BlockContext, routesSelf: boolean, touch = true): Promise<TaskCollectionRef | undefined> => {
    const partition = await filingSessionIdOf(ctx.session);
    const ref = await conversationLedgerAt(ctx, partition);
    if (ref === undefined) return undefined;
    // A touch runs the pass when something is startable or past due (FIX-2078):
    // the pass pays it, one at a time. A touch resends nothing itself. Don't
    // narrow it to writes, or to a session that files now: rows filed before
    // it lost its last task-taking delegate still run and are heard (FIX-1802 BR-5).
    // A read never touches (FIX-2286 D2): the pass writes, and a row's start is
    // owed by the wake its writer sent, not by a look.
    if (touch && hasPastDue(ref.list(), ref.now())) await triggerPass(ctx);
    else if (touch && hasStartable(ref)) await triggerPass(ctx, { touch: true });
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

  /** A read reaches the board here: an action's reach, with no touch (FIX-2286 D2). */
  const readResolver: TaskCollectionResolver = (ctx) => reachBoard(ctx, false, false);

  /** The repairs a pass runs before its drain, and again after (`payBoardDebts`). */
  const delivery = conversationDelivery(CONVERSATION_LEDGER_ID);
  const planDelivery = conversationDelivery(PLAN_LEDGER_ID);
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
    let next = debts.nextDue;
    const later = (at: number) => {
      next = next === undefined ? at : Math.min(next, at);
    };
    // The last ready check: a row still startable is a start owed. One whose
    // session another board's routed task holds is looked at again later:
    // nothing on this board hears that task end.
    const held = await sessionsHeldElsewhere(ctx, ref);
    if (held !== undefined) noteHeldElsewhere(ref, held);
    if (hasStartable(ref)) later(Date.now() + NOTICE_DUE_MS);
    else if (hasStartable(ref, undefined, true)) later(Date.now() + HELD_ELSEWHERE_RETRY_MS);
    return next;
  };

  /** The pass's first half: read its wake, then repair, before the drain. */
  const beforeDrain = handler({
    name: "conversation-board-before-drain",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    resources: { ...conversationLedgerResources, ...taskChainResources, ...routedSessionResources, ...(options.messages?.resources ?? {}) },
    requestStateSchema: passStateSchema,
    execute: async (_input, ctx) => {
      notePassStarted(ctx as never);
      const wake = await ctx.requestHost?.wakes?.read(DISPATCH_ENTRY);
      await ctx.request.patchState({ passWake: wake === undefined ? undefined : { dueAt: wake.dueAt, landBy: wake.landBy, version: wake.version }, passRounds: 0 });
      const partition = await filingSessionIdOf(ctx.session);
      const ref = await conversationLedgerAt(ctx, partition);
      if (ref !== undefined) await repairs(ctx as never, ref, partition);
      // A step handed to a session of its own resumes the drain that waits on
      // it from here (FIX-2082 D2): the plan ledger owes no notice, only that.
      const plan = planning.wired() ? await planLedgerAt(ctx as never, partition) : undefined;
      // A resume it couldn't pay (the drain still parking reads `busy`) stays
      // owed: the settle keeps its due time, or nothing would retry it before
      // the wait's deadline.
      if (plan !== undefined) {
        const planDebts = await payBoardDebts(ctx as never, plan, { filerOf: filerResolver(planDelivery, plan.partition), resend: false });
        if (planDebts.nextDue !== undefined) await ctx.request.patchState({ passPlanDue: planDebts.nextDue });
      }
      // The messages this session sent that haven't landed (FIX-2240), in
      // any session that sends, filing or not: sent again, or ended and told.
      if (options.messages !== undefined) {
        const messagesDue = await options.messages.payDebts(ctx as never);
        if (messagesDue !== undefined) await ctx.request.patchState({ passMessagesDue: messagesDue });
      }
      return {};
    }
  });

  /**
   * A round's last half: repair again (what the drain's own endings owe),
   * mark each of this board's pieces added in its chain (a crash between an
   * add and its mark leaves it reserved, and the lease must never drop a
   * piece that landed), and the last ready check: a row startable now (one
   * this pass's own drain or repairs made ready) runs another round, up to
   * {@link MAX_PASS_ROUNDS}.
   */
  const afterRound = handler({
    name: "conversation-board-after-run",
    inputSchema: z.unknown(),
    outputSchema: z.object({ again: z.boolean(), nextDue: z.number().optional() }),
    resources: { ...conversationLedgerResources, ...taskChainResources, ...routedSessionResources },
    requestStateSchema: passStateSchema,
    execute: async (_input, ctx) => {
      const partition = await filingSessionIdOf(ctx.session);
      const ref = await conversationLedgerAt(ctx, partition);
      if (ref === undefined) return { again: false };
      const nextDue = await repairs(ctx as never, ref, partition, false);
      const top = taskChainOf(ctx)?.top;
      if (top !== undefined) await markAddedInChain(ctx, top, ref.list().map((row) => chainEntryKey(partition, row.id)));
      const rounds = (passStateOf(ctx as never).passRounds ?? 0) + 1;
      await ctx.request.patchState({ passRounds: rounds });
      const again = hasStartable(ref) && rounds < MAX_PASS_ROUNDS;
      return nextDue === undefined ? { again } : { again, nextDue };
    }
  });

  /** The pass's last step: move the session's wake to the next debt's due time, or clear it. */
  const settleWake = handler({
    name: "conversation-board-settle-wake",
    inputSchema: z.object({ again: z.boolean(), nextDue: z.number().optional() }),
    outputSchema: z.object({ nextDue: z.number().optional() }),
    requestStateSchema: passStateSchema,
    execute: async (round, ctx) => {
      notePassEnded(ctx as never);
      const { passPlanDue, passMessagesDue } = passStateOf(ctx as never);
      const dues = [round.nextDue, passPlanDue, passMessagesDue].filter((at): at is number => at !== undefined);
      const due = dues.length === 0 ? undefined : Math.min(...dues);
      await settlePassWake(ctx as never, DISPATCH_ENTRY, passStateOf(ctx as never).passWake, due);
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
  // Chosen per turn: `getTask`'s wait is offered only where the host can hold
  // one (FIX-1816, FIX-2082). This board resumes waits: its pass resumes the
  // requests owed a resume when their task ends. A task session's request may
  // wait too, up to five deep. And it dispatches (FIX-1875): its ref's filings
  // wake a run of it, so a `createTask` starts work now.
  // On a turn routing a message, a `createTask` with its result to the
  // conversation files a routed task (FIX-2083), through `options.routes`.
  const eight = taskToolsForTurn(turnResolver, turnRoster, {
    resumesWaits: true,
    dispatches: true
  });
  const routes = options.routes;
  const tools = defineCapability({
    name: "taskTools",
    resources: { ...conversationLedgerResources, ...planLedgerResources, ...taskChainResources },
    presets: {
      tools: {
        controlTools: async (ctx) => ((await turnFiles(ctx as never)) ? eight(ctx as never) : []),
        // The session's project, read from its server-written fields (BP-031),
        // so a filer in a workstream or a project's conversation never has to
        // guess one: the board writes it on every task filed here anyway. On
        // a turn routing a message, how to hand it on (FIX-2083).
        context: async (_input, ctx) => {
          const routing = routes !== undefined && routes.routing(ctx as never) && (await files(ctx as never)) ? routes.description : undefined;
          const own = filingProjectAddressOf(ctx.session.state);
          if (own === undefined || !(await files(ctx as never))) return routing;
          // A project id is its creator's text and may hold quotes, so it goes
          // in as a JSON string: it can't close the name and start a sentence.
          const project =
            `This conversation works in the ${own.visibility} project ${JSON.stringify(own.id)}. ` +
            "Every task you file here works in that project, so leave `project` out of a task's `input`.";
          return routing === undefined ? project : `${project}\n\n${routing}`;
        }
      },
      default: ["tools"]
    }
  });

  /**
   * File a routed task on the running conversation's board, and start it
   * (FIX-2083): the write under a coordinator's one filing step, for every
   * policy, every round and a judgment turn's filing. Not through the
   * caller-facing guard: its filer has checked it, its brief is server-written,
   * and it is in no chain. A wake lost after the add leaves the row startable
   * for the next touch, as any filing's.
   *
   * @param init The task, with the id derived from its message, round and
   *   delegate record, so a repeat finds it.
   * @returns `exists` when a task with that id is already on the board: the
   *   delegate was already handed this message in this round.
   * @throws when the conversation keeps no board, or the add is refused (a
   *   full board): the message wasn't handed on.
   */
  const fileRouted = async (ctx: BlockContext, filing: TaskInit & { id: string }): Promise<"filed" | "exists"> => {
    const ref = await conversationLedgerAt(ctx, await filingSessionIdOf(ctx.session));
    if (ref === undefined) throw new Error("this conversation keeps no board to hand the message on through");
    if (ref.get(filing.id) !== undefined) return "exists";
    // What a model asked beside the message is a caller's, as on any filing:
    // no board marker in its metadata, and the session's own project in its input.
    // The filing turn's hop count, which the task's turn starts at (FIX-2106).
    const { stamp, own } = await filedProjectFor(ctx);
    const metadata = { ...callerMetadata(filing.metadata), [FILED_HOP]: heldFromFiling(filing) ? freshHopMark(ctx) : turnHopMark(ctx), [FILED_PROJECT]: stamp };
    const input = ownProjectIn(filing.input, own);
    const { metadata: _metadata, input: _input, ...rest } = filing;
    const init: TaskInit & { id: string } = {
      ...rest,
      metadata,
      ...(input !== undefined ? { input } : {})
    };
    await owePass(ctx);
    let added: Task;
    try {
      added = await ref.createTask(init);
    } catch (error) {
      // Two routings of one message at once: the other's add landed first.
      if (ref.get(init.id) !== undefined) return "exists";
      throw error;
    }
    // A second message to a busy delegate waits on the board (FIX-2080's one
    // open task per session): the pass that frees its session starts it.
    if (isStartable(added, ref.list())) await triggerPass(ctx);
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
    fileRouted,
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
    /** The task tools as public actions, `<tool>_tasks`. */
    actions: taskToolActions(CONVERSATION_LEDGER_ID, resolver, roster, { dispatches: true }),
    /**
     * The task list as a read, `listTasks_tasks` (FIX-2286): the action's rows,
     * stored nowhere. Spread into the flow's `reads` beside `actions`.
     */
    reads: taskToolReads(CONVERSATION_LEDGER_ID, readResolver),
    /** The ledger, the plan ledger, the chain records and the routed-session records, for the flow's `resources`. */
    resources: { ...conversationLedgerResources, ...planLedgerResources, ...taskChainResources, ...routedSessionResources }
  };
}


