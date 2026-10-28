/**
 * Shared helpers used by both TaskCollection backings.
 *
 * Centralizing init/transition logic here keeps the two backings in
 * lockstep on default values, claim eligibility, and the post-mutation
 * task shape that ends up on the emitted `task-change` component item.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { ticketNamesTask } from "../claim-ticket";
import { generateId } from "../generate-id";
import { initialWriteProvenance } from "../write-provenance";
import type { Task, TaskClaimIdentity, TaskRunLink, TaskStatus } from "../schema/task";
import type { TaskClaimTicket } from "../claim-ticket";
import type { TaskInit, TaskFilter } from "../schema/task-init";
import { matchesFilter } from "../schema/task-init";
import {
  isTerminalStatus,
  isTransitionAllowed,
} from "../schema/task-status";
import { extractTaskItems } from "../items/extract-window";
import { applyEndingRecorder, endingOf, type TaskEnding, type TaskEndingRecorder } from "./ending";
import { deliveredByWait, droppedHeldNotices, recordEnding as recordNoticeOwed, releasedHeldNotices, takenNoticePatch, withoutNoticeMarkers, type TaskNotice } from "../notice/task-notice";
import { assertDepsEditable, TaskFilingRefusedError } from "./filing";
import { hasStarted, lockedFields, type TaskEditField } from "./field-rules";
import { steersForAttempt, untakenSteers } from "../steers";
import type { SuspensionQuestion } from "../schema/question";
import { answerOf, askedOnTicket, droppedMirror, hasOpenQuestion, questionWrite, isRowQuestion, keptOnEnding, newRowQuestions, openRowQuestions, owesTurn } from "./questions";
import type { TaskChangeKind } from "./change-event";
import type {
  ClaimOptions,
  TaskHandle,
  TaskTransitionOptions,
  TaskWaitSlot,
  TaskWriteDeclineReason,
} from "./types";

function generateTaskId(): string {
  return generateId("task");
}

/**
 * Build a `TaskHandle` factory closed over the collection's id and item-log
 * accessor (FIX-480). Both backings call this once at construction.
 *
 * Data fields are snapshot at wrap time (matches the pre-FIX-480 `Task`
 * read contract). `items()` is live — re-reads the item log at call time
 * so synthesizers running after worker completion see the latest window.
 */
export function createTaskHandleWrapper<TInput, TOutput>(
  collectionId: string,
  getItems: (() => readonly OutputItem[]) | undefined,
): (task: Task<TInput, TOutput>) => TaskHandle<TInput, TOutput> {
  return (task) => ({
    ...task,
    items: () => {
      if (getItems === undefined) return [];
      return extractTaskItems(getItems(), collectionId, task.id);
    },
  });
}

/**
 * Build a fresh task from a `TaskInit`, stamping defaults and timestamps.
 *
 * The convergence point for a task's *initial* write provenance (FIX-989):
 * every add path on both backings builds its task here, so revision 1, the
 * truncation marker, and the incarnation nonce are set once rather than at
 * four call sites.
 *
 * `incarnationId` is minted here rather than folded into
 * `initialWriteProvenance()` because it answers a different question — task
 * *identity* across delete/recreate, not write bookkeeping — but it is
 * stamped at the same site for the same reason: one place, covering all four
 * add paths, so a recreated row can never end up sharing an incarnation with
 * the row it replaced.
 *
 * Minted with `crypto.randomUUID()`, not `generateId` — the nonce is persisted
 * and compared across processes (a resource-backed board on SQLite/Postgres is
 * explicitly multi-process), and `generateId`'s own header says nothing about
 * it compares across machines: its counter is per-process and its random tail
 * is only 24 bits, so two processes can mint the same value. `generateId` stays
 * for task ids themselves — that scheme is pre-existing and changing it would
 * alter an already-persisted id format — but the nonce is new in this PR and
 * has no such compatibility concern.
 */
export function buildInitialTask<TInput, TOutput>(
  init: TaskInit<TInput>,
  now: number,
  createdBy?: string,
  filer?: Task["filer"],
  filing: FilingStamp = {}
): Task<TInput, TOutput> {
  const status = init.held === true ? "held" : (init.status ?? "pending");
  // The filer's questions and confirms, each a row hold that keeps the task
  // from starting until it is answered (FIX-2133), due when the host sets a deadline.
  const holds =
    init.questions !== undefined && init.questions.length > 0
      ? newRowQuestions(init.questions, now, filing.questionDueMs !== undefined ? { dueMs: filing.questionDueMs } : {})
      : undefined;
  const filedUnder = filing.filedUnder;
  return {
    ...initialWriteProvenance(),
    incarnationId: crypto.randomUUID(),
    id: init.id ?? generateTaskId(),
    goal: init.goal,
    title: init.title,
    context: init.context,
    status,
    attempts: 0,
    // A conversation-result task has one attempt: unset reads as 1. Any other
    // value was refused at filing (`assertFilingSettings`).
    maxAttempts: init.resultTo === "conversation" ? (init.maxAttempts ?? 1) : init.maxAttempts,
    assignee: init.assignee,
    deps: init.deps,
    priority: init.priority,
    input: init.input,
    labels: init.labels,
    // A filing can't forge, clear or settle a notice (BP-031).
    metadata: withoutNoticeMarkers(init.metadata),
    ...(init.followUpOf !== undefined ? { followUpOf: init.followUpOf } : {}),
    ...(init.filedByTask !== undefined ? { filedByTask: init.filedByTask } : {}),
    ...(init.session !== undefined ? { session: init.session } : {}),
    ...(init.resultTo !== undefined ? { resultTo: init.resultTo } : {}),
    ...(init.target !== undefined ? { target: init.target } : {}),
    ...(init.targetSessionId !== undefined ? { targetSessionId: init.targetSessionId } : {}),
    ...(init.sealed !== undefined ? { sealed: init.sealed } : {}),
    // Only a row stored cancelled (a replan's skip) names a cause: `held` wins
    // over `status`, so a held row keeps neither.
    ...(status === "cancelled" && init.error !== undefined ? { error: init.error } : {}),
    ...(status === "cancelled" && init.causedBy !== undefined ? { causedBy: init.causedBy } : {}),
    ...(createdBy !== undefined ? { createdBy } : {}),
    ...(filedUnder !== undefined && (filedUnder.tenantId !== undefined || filedUnder.orgId !== undefined)
      ? {
          filedUnder: {
            ...(filedUnder.tenantId !== undefined ? { tenantId: filedUnder.tenantId } : {}),
            ...(filedUnder.orgId !== undefined ? { orgId: filedUnder.orgId } : {}),
          },
        }
      : {}),
    ...(holds !== undefined ? { questions: holds } : {}),
    // Server-written by the backing (FIX-2078), never from `init`.
    ...(filer !== undefined ? { filer: { sessionId: filer.sessionId, ...(filer.requestId !== undefined ? { requestId: filer.requestId } : {}) } } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * What a backing stamps on every row it files beside the filer (FIX-2133):
 * the tenant and org the filing request ran under, from its verified
 * identity, and how long a row hold waits before it goes ahead unanswered,
 * when the host sets that (`RequestHost.userDeadlineMs`). Server-set, never
 * from `TaskInit`.
 */
export interface FilingStamp {
  readonly filedUnder?: { readonly tenantId?: string; readonly orgId?: string };
  readonly questionDueMs?: number;
}

/**
 * How many times this task's work was abandoned by a dead worker and handed
 * back out (FIX-1005), with the BP-030 legacy guard applied.
 *
 * The `readRetryLedger` posture exactly, and for the same reason: **absent
 * reads as zero**. A row persisted before the upgrade — or one an older
 * writer normalized, which drops a key its schema does not know — gets the
 * full allowance rather than none. That direction is deliberate. Over-recovery
 * is in policy; withholding recovery is the bug this mechanism exists to fix,
 * so a counter that could read as *exhausted* when it is merely missing would
 * strand exactly the rows the mechanism is for.
 */
export function readAbandonments(task: Task): number {
  return task.abandonments ?? 0;
}

/**
 * Why an assignee change to `assignee` is refused on `task`, beyond the
 * terminal and attempt-held rules each backing applies (FIX-1817), or
 * `undefined` when it isn't. Decided inside the atomic write, so a claim
 * landing between a caller's read and the write is honoured.
 *
 * - `follow-up`: a follow-up keeps the worker of the task it follows, whose
 *   session it runs in.
 */
export function assigneeChangeDecline(task: Task, assignee: string): TaskWriteDeclineReason | undefined {
  if (task.assignee === assignee) return undefined;
  if (task.followUpOf !== undefined) return "follow-up";
  return undefined;
}

/**
 * The one rule for taking a row's wait slot (`TaskCollectionRef.markWait`,
 * FIX-2082), decided on the freshest committed row, inside the write, so two
 * requests that read the slot free can't both take it. Both backings run it.
 *
 * A request takes a free slot, a lapsed one (the request that waited before
 * is no longer parked on it), or one it already holds: the same gate (a
 * replay of the call that took it) or the same request (a drain waiting again
 * at its deadline). Any other live slot is another request's wait.
 *
 * @returns The patch to write, `undefined` when the slot is already this gate's,
 *   or the reason it is refused: `terminal` for a row that has ended (the
 *   caller reads its ending at once), `disallowed` for another request's wait.
 */
export function markWaitWrite(
  task: Task,
  slot: TaskWaitSlot,
): { patch: Partial<Task> } | { decline: TaskWriteDeclineReason } | undefined {
  if (isTerminalStatus(task.status)) return { decline: "terminal" };
  const held = task.wait;
  if (held != null && held.gateId === slot.gateId && held.lapsed !== true) return undefined;
  if (held != null && held.lapsed !== true && held.requestId !== slot.requestId) return { decline: "disallowed" };
  return {
    patch: {
      wait: { gateId: slot.gateId, deadline: slot.deadline, requestId: slot.requestId, ...(slot.drain === true ? { drain: true } : {}) },
    },
  };
}

/**
 * The one rule for lapsing a wait slot at its deadline
 * (`TaskCollectionRef.lapseWait`, FIX-2082), inside the write that loses to an
 * ending already written: a row that has ended is refused `terminal`, and its
 * caller reads the ending instead. The slot names the request that lapsed it,
 * the one an ending is then held for: a slot a filing wrote before FIX-2082
 * named none.
 *
 * @returns The patch to write, `undefined` when the slot is another gate's or
 *   already lapsed, or the `terminal` refusal.
 */
export function lapseWaitWrite(
  task: Task,
  gateId: string,
  requestId: string,
): { patch: Partial<Task> } | { decline: TaskWriteDeclineReason } | undefined {
  if (isTerminalStatus(task.status)) return { decline: "terminal" };
  if (task.wait == null || task.wait.gateId !== gateId || task.wait.lapsed === true) return undefined;
  return { patch: { wait: { ...task.wait, requestId, lapsed: true } } };
}

/**
 * The one rule for releasing a lapsed wait slot (`TaskCollectionRef.releaseWait`,
 * FIX-2082): the request it was lapsed for read the row (`read`), so an ending
 * it held is delivered and owes nothing; or that request ended without reading
 * it, so the held ending goes to the filer's notice, due `dueAt`. Either way the
 * slot clears, and a later ending owes the filer's notice as any other does.
 *
 * @returns The patch to write, or `undefined` when the slot is not a lapsed one
 *   that request holds.
 */
export function releaseWaitWrite(
  task: Task,
  release: { readonly requestId: string; readonly read: boolean; readonly dueAt: number },
): { patch: Partial<Task> } | undefined {
  const held = task.wait;
  if (held == null || held.lapsed !== true || held.requestId !== release.requestId) return undefined;
  const notices = release.read ? droppedHeldNotices(task) : releasedHeldNotices(task, release.dueAt);
  return {
    patch: {
      wait: undefined,
      ...(Object.keys(notices).length > 0 ? { metadata: { ...(task.metadata ?? {}), ...notices } } : {}),
    },
  };
}

/**
 * The one rule for a wait that found its row already ended
 * (`TaskCollectionRef.dropNoticeReadByWait`, FIX-2112): the wait's answer
 * delivered the ending, so the notice the ending owes the filer is dropped.
 *
 * A notice already taken is left: its notice is the delivery (FIX-2123).
 *
 * @returns The patch to write, or `undefined` when the row owes no notice for its ending.
 */
export function noticeReadByWaitWrite(task: Task): { patch: Partial<Task> } | undefined {
  const dropped = deliveredByWait(task);
  if (Object.keys(dropped).length === 0) return undefined;
  return { patch: { metadata: { ...(task.metadata ?? {}), ...dropped } } };
}

/**
 * The one rule for taking a notice to deliver it
 * (`TaskCollectionRef.takeNotice`, FIX-2123): decided on the row as stored, so
 * a wait's drop and a take can't both go through.
 *
 * @returns The patch to write, or `undefined` when the row doesn't owe the
 *   notice, or another request holds it.
 */
export function noticeTakeWrite(
  task: Task,
  notice: Pick<TaskNotice, "attempt" | "ending">,
  take: { readonly by: string; readonly at: number; readonly replacing?: string }
): { patch: Partial<Task> } | undefined {
  const taken = takenNoticePatch(task, notice, take);
  if (Object.keys(taken).length === 0) return undefined;
  return { patch: { metadata: { ...(task.metadata ?? {}), ...taken } } };
}

/**
 * The fields a filing may change until the task first starts (FIX-2080,
 * ER-4; the brief's fields and the assignee since FIX-2081). Each field's rule
 * is the field table's (`./field-rules`), read inside the write.
 */
export interface TaskSettingsPatch {
  /** Hold the task (`true`) or release it (`false`). */
  held?: boolean;
  /** Its dependencies, replaced whole. Checked as a filing's are. */
  deps?: string[];
  /** Its attempts. */
  maxAttempts?: number;
  /** What it is for. */
  goal?: string;
  /** Its short label. */
  title?: string;
  /** What its worker is told beside the goal. */
  context?: string;
  /** Its structured input. */
  input?: unknown;
  /** Its priority. */
  priority?: number;
  /** Its labels, replaced whole. */
  labels?: string[];
  /** Metadata keys merged over its own. */
  metadata?: Record<string, unknown>;
  /** Who works it. A follow-up keeps its root's worker. */
  assignee?: string;
}

export { hasStarted };

/**
 * A release and nothing else, of a row stored `blocked` before FIX-2080
 * (`heldFromBlocked`, set only at the read boundary). Such a row may have
 * started before it was blocked, and a release is how it runs again
 * (BP-030). No current path holds a started row, so any other started held
 * row keeps the field table's rule: no release. Field edits stay locked.
 */
function legacyReleaseOnly(task: Task, patch: TaskSettingsPatch): boolean {
  return task.status === "held" && task.heldFromBlocked === true && patch.held === false && patchFields(patch).length === 1;
}

/**
 * The status check the field table leaves: a settings edit lands only on a
 * pending or held row. Which fields a started row still takes is the
 * table's call (`lockedFields`), not this one's.
 */
function settingsDecline(task: Task): TaskWriteDeclineReason | undefined {
  return task.status !== "pending" && task.status !== "held" ? "started" : undefined;
}

/** The fields a patch names, in the field table's words. */
function patchFields(patch: TaskSettingsPatch): TaskEditField[] {
  return (Object.keys(patch) as Array<keyof TaskSettingsPatch>).filter(
    (field) => patch[field] !== undefined,
  ) as TaskEditField[];
}

/**
 * The one guard on editing a filing (FIX-2080, ER-4; every field since
 * FIX-2081), decided on the freshest committed row, inside the write: each
 * field the patch names changes only while the field table allows it
 * (`TASK_FIELD_RULES`), which for every field here is until the row first
 * starts. Both backings run it. Terminal rows are refused by the caller's
 * `declineOnTerminal` before this runs.
 *
 * A conversation-result task's attempts are refused first, in every state:
 * it has one, whenever it is asked.
 *
 * @param lookup The board's committed row by id, for the dependency check.
 * @returns The patch to write, `undefined` when nothing changes, or the
 *   reason it is refused.
 * @throws {TaskFilingRefusedError} for dependencies a filing couldn't name,
 *   or an attempts value the task's result setting refuses.
 */
export function settingsWrite(
  task: Task,
  patch: TaskSettingsPatch,
  lookup: (id: string) => Task | undefined,
): { patch: Partial<Task> } | { decline: TaskWriteDeclineReason } | undefined {
  if (patch.maxAttempts !== undefined && task.resultTo === "conversation" && patch.maxAttempts !== 1) {
    throw new TaskFilingRefusedError({
      rule: "conversation_result_one_attempt",
      taskId: task.id,
      detail: `task "${task.id}" sends its result to the conversation, so it has one attempt. Nothing was written.`,
    });
  }
  const locked = legacyReleaseOnly(task, patch) ? [] : lockedFields(task, patchFields(patch));
  if (locked.length > 0) return { decline: "started" };
  const declined = settingsDecline(task);
  if (declined !== undefined) return { decline: declined };
  const update: Partial<Task> = {};
  if (patch.held === true && task.status === "pending") update.status = "held";
  if (patch.held === false && task.status === "held") {
    update.status = "pending";
    // The legacy mark serves one release; a later hold is an ordinary one.
    if (task.heldFromBlocked === true) update.heldFromBlocked = undefined;
  }
  if (patch.deps !== undefined && !sameIds(patch.deps, task.deps)) {
    assertDepsEditable(task.id, patch.deps, lookup);
    update.deps = [...patch.deps];
  }
  if (patch.maxAttempts !== undefined && patch.maxAttempts !== task.maxAttempts) {
    if (!Number.isInteger(patch.maxAttempts) || patch.maxAttempts < 1) {
      throw new Error(`[tasks] maxAttempts must be a positive integer, got ${String(patch.maxAttempts)}.`);
    }
    update.maxAttempts = patch.maxAttempts;
  }
  if (patch.assignee !== undefined && patch.assignee !== task.assignee) {
    const assigneeDeclined = assigneeChangeDecline(task, patch.assignee);
    if (assigneeDeclined !== undefined) return { decline: assigneeDeclined };
    update.assignee = patch.assignee;
  }
  if (patch.goal !== undefined && patch.goal !== task.goal) update.goal = patch.goal;
  if (patch.title !== undefined && patch.title !== task.title) update.title = patch.title;
  if (patch.context !== undefined && patch.context !== task.context) update.context = patch.context;
  if (patch.input !== undefined) update.input = patch.input;
  if (patch.priority !== undefined && patch.priority !== task.priority) update.priority = patch.priority;
  if (patch.labels !== undefined && !sameIds(patch.labels, task.labels)) update.labels = [...patch.labels];
  if (patch.metadata !== undefined && Object.keys(patch.metadata).length > 0) {
    update.metadata = { ...(task.metadata ?? {}), ...patch.metadata };
  }
  return Object.keys(update).length === 0 ? undefined : { patch: update };
}

/** The change kind a settings write publishes: a hold or a release, else a settings change. */
export function settingsChangeKind(prev: TaskStatus, next: TaskStatus): TaskChangeKind {
  if (prev === "pending" && next === "held") return "held";
  if (prev === "held" && next === "pending") return "released";
  return "settings_changed";
}

function sameIds(a: readonly string[], b: readonly string[] | undefined): boolean {
  const other = b ?? [];
  return a.length === other.length && a.every((id, i) => id === other[i]);
}

/**
 * How many times a task's work may be handed back out after its worker died
 * before the substrate stops recovering it and settles the row `errored`
 * (FIX-1005).
 *
 * Three, because a bad deploy or a cycling node strands a job once or twice.
 * That covers the class while still bounding duplicate side effects at a small
 * constant — and because this is its OWN budget, a job with no `maxAttempts`
 * gets these three rather than the zero a shared budget would leave it.
 */
export const DEFAULT_MAX_ABANDONMENTS = 3;

/**
 * Decide whether `fail(id, error)` should re-pend (retry path) or
 * transition the task to terminal `errored`. Centralized so both
 * backings agree on the contract.
 *
 * Semantics: when `task.maxAttempts` is set and the task's *own* failures have
 * not yet spent it, `fail` is treated as a soft fail — status flips to
 * `pending`, the error is captured on `feedback`, and the next claim picks up
 * a fresh attempt. Otherwise the call is a hard fail — terminal `errored`.
 *
 * `attempts` is incremented at claim time (`applyClaimToTask`), so
 * after the first failed attempt `attempts === 1`. With
 * `maxAttempts === 3`, the comparison `1 < 3` permits two more
 * retries before the budget is exhausted on the third failure.
 *
 * **Abandonments are discounted, and that is what makes the two budgets
 * separate rather than separate-in-name-only (FIX-1005).** Recovering an
 * abandoned row goes through `claim`, which advances `attempts` — so without
 * the discount a crashed machine would silently spend the retries the caller
 * configured for real failures. `attempts - abandonments` is the count of
 * attempts this task actually got to run out of its own budget.
 *
 * An answer to a question (FIX-2133) and a steer (FIX-2086) take a turn on
 * the same attempt, so neither uses one.
 */
function shouldRetryOnFail(task: Task): boolean {
  if (task.maxAttempts === undefined) return false;
  return task.attempts - readAbandonments(task) < task.maxAttempts;
}

/**
 * The status an in-flight attempt can be said to *hold*.
 *
 * Everything else means the attempt was displaced (reclaimed, re-queued) or
 * the task was settled by someone else.
 *
 * Exported because the retry budget (FIX-948) is scoped to exactly this set, and
 * that reuse is exact rather than coincidental — see {@link routeFailure}.
 */
export const ATTEMPT_OWNED_STATUSES = new Set<TaskStatus>(["in_progress"]);

/**
 * The change kinds that mean "this attempt is reporting its result" (FIX-1234).
 *
 * Named because {@link transitionDeclineReason} refuses exactly these on a row
 * that is held (FIX-2133), and the set is not guessable from the target
 * status: a failure with retries left targets `pending`, which is also where a
 * reclaim lands. The kind separates them; the status cannot.
 */
const SETTLEMENT_CHANGE_KINDS = new Set<TaskChangeKind>([
  "completed",
  "errored",
  "retried",
]);

/**
 * Read a task's retry ledger with the BP-030 legacy guard applied (FIX-948).
 *
 * One `== null` check on the object rather than one per member, which is the
 * concrete reason the two facts live in one field. Absent means "no counted
 * history" — a task persisted before FIX-948, or one that has never failed.
 * Never let an absent ledger become `undefined` arithmetic in the sum.
 */
function readRetryLedger(task: Task): { granted: number; deniedByBudget: boolean } {
  const ledger = task.retryLedger;
  if (ledger == null) return { granted: 0, deniedByBudget: false };
  return {
    granted: ledger.granted ?? 0,
    deniedByBudget: ledger.deniedByBudget === true,
  };
}

/**
 * The task's retry ledger with one more grant recorded (FIX-948).
 *
 * Written in the SAME patch that re-pends the task, which is the property the
 * whole bound rests on: the counted fact changes when the retry is *authorized*,
 * not when it is later observed at claim time.
 */
export function grantRetry(task: Task): { granted: number; deniedByBudget: boolean } {
  const ledger = readRetryLedger(task);
  return { granted: ledger.granted + 1, deniedByBudget: ledger.deniedByBudget };
}

/**
 * The task's retry ledger with the budget denial recorded (FIX-948).
 *
 * Written in the same patch that settles the task terminal. This is the marker
 * the board's `terminationReason` reads — it exists precisely so that reason is
 * never inferred from `retries === limit`, which does not establish that
 * anything was refused.
 */
export function denyRetry(task: Task): { granted: number; deniedByBudget: boolean } {
  return { granted: readRetryLedger(task).granted, deniedByBudget: true };
}

/** Sum the authorized-retry grants across a ledger — the board's retry total. */
export function sumGrantedRetries(tasks: Iterable<Task>): number {
  let total = 0;
  for (const task of tasks) total += readRetryLedger(task).granted;
  return total;
}

/** True once any task in the ledger had a retry refused by the budget. */
export function anyRetryDeniedByBudget(tasks: Iterable<Task>): boolean {
  for (const task of tasks) {
    if (readRetryLedger(task).deniedByBudget) return true;
  }
  return false;
}

/**
 * How `fail(id, error)` should route this failure — the one place retry-vs-
 * terminal is decided, widened by FIX-948 to also answer the collection's
 * cumulative retry budget.
 *
 * - `retry` — re-pend. `countsAgainstBudget` says whether this grant is recorded
 *   on the task and therefore consumes the board's allowance.
 * - `terminal` — settle `errored`. `deniedByBudget` distinguishes "the board's
 *   budget refused this retry" from "this task had no retry budget of its own",
 *   which is today's unchanged behaviour.
 */
export type FailRouting =
  | { action: "retry"; countsAgainstBudget: boolean }
  /**
   * `limit` is present exactly when `deniedByBudget` is true, so the error
   * message can name the budget without a cast the type system cannot check.
   */
  | { action: "terminal"; deniedByBudget: false }
  | { action: "terminal"; deniedByBudget: true; limit: number };

/**
 * Decide how a `fail()` routes, given the task, the board's granted-retry total,
 * and the budget in force (FIX-948).
 *
 * **Must be called from inside the atomic write**, against the committed ledger,
 * so `grantedTotal` and the grant this decision authorizes land together. A
 * budget compared against a total read outside the write is a check-after-read
 * race, and the overshoot it admits is exactly what the bound exists to prevent.
 *
 * Two gates, in this order, and the second is a correctness requirement rather
 * than a nicety:
 *
 * 1. **The task's own `maxAttempts` still decides first.** Without one, or with
 *    it exhausted, the failure is terminal exactly as before — the budget can
 *    only ever refuse a retry that would otherwise have happened, and it can
 *    never refuse a first attempt.
 * 2. **The budget applies only to attempt-owned failures.** `errored` is
 *    reachable from `in_progress` and from NEITHER
 *    `pending` nor `held`, while this routing is status-blind on the
 *    `maxAttempts` half — so a `fail()` on a pending task carrying
 *    `maxAttempts` legally re-pends today, and rerouting it to `errored` at the
 *    bound would attempt an illegal transition and THROW instead of settling, on
 *    a reachable path. So both the accounting and the denial are gated on
 *    {@link ATTEMPT_OWNED_STATUSES} — which is precisely the set from which the
 *    reroute is legal, and is also the set for which a *settlement* is
 *    meaningful at all: a task that held no attempt has nothing to settle.
 *    Widening the transition table instead was rejected — permitting
 *    `pending → errored` would let a fresh, never-attempted task be failed
 *    outright, which is a new correctness hole rather than a fix.
 *
 * @param grantedTotal Sum of granted retries across the committed ledger.
 * @param maxTotalRetries The budget in force, or `undefined` for unbounded —
 *   which is what the resource backing passes, since it counts but cannot
 *   enforce.
 */
export function routeFailure(
  task: Task,
  grantedTotal: () => number,
  maxTotalRetries: number | undefined
): FailRouting {
  // A held task hasn't started, so it has no failure to retry: re-pending it
  // would be a release in disguise (FIX-2080). Routed terminal, which the
  // status table refuses from `held`, so the failure is refused.
  if (task.status === "held") return { action: "terminal", deniedByBudget: false };
  if (!shouldRetryOnFail(task)) return { action: "terminal", deniedByBudget: false };
  if (!ATTEMPT_OWNED_STATUSES.has(task.status)) {
    return { action: "retry", countsAgainstBudget: false };
  }
  // `grantedTotal` is a thunk so the O(tasks) sum is only walked once the two
  // cheap gates above have passed and a budget is actually in force.
  if (maxTotalRetries === undefined || grantedTotal() < maxTotalRetries) {
    return { action: "retry", countsAgainstBudget: true };
  }
  return { action: "terminal", deniedByBudget: true, limit: maxTotalRetries };
}

/**
 * The error recorded on a task settled by the collection's retry budget rather
 * than by its own `maxAttempts` (FIX-948).
 *
 * Names the board's budget explicitly, because the whole point of the bound is
 * that an operator can tell "we stopped retrying because the budget ran out"
 * from "this task ran out of its own attempts". The structured fact a consumer
 * should branch on is `task.retryLedger.deniedByBudget` — this string is for a
 * human reading the failure.
 */
export function retryBudgetExhaustedError(
  error: string,
  limit: number,
  collectionId: string
): string {
  return (
    `${error} — not retried: collection "${collectionId}" has spent its retry budget of ` +
    `${limit} (maxTotalRetries). Raise it, or pass null to opt out.`
  );
}

/**
 * True when the ticket's attempt still owns `task` (FIX-951).
 *
 * Ownership is the counter **and** the status, not the counter alone.
 * `reclaim()` returns a task to `pending` without touching `attempts` — it
 * advances only on the next claim (`applyClaimToTask`) — so in the window
 * between a reclaim and the next claim a displaced worker matches the
 * counter by construction. `attempts` is a claim counter, and only
 * incidentally an ownership token while the task sits in a status an
 * attempt holds.
 *
 * This asks only *"is my attempt still the live one on this task"*. Whether
 * this is even the right task is {@link ticketNamesTask}'s question, asked
 * first — see {@link transitionDeclineReason}.
 */
function attemptOwnsTask(task: Task, attempt: number): boolean {
  return task.attempts === attempt && ATTEMPT_OWNED_STATUSES.has(task.status);
}

/**
 * Whether the turn `ticket` was minted for still runs `task` (FIX-2133 D3):
 * the same row, `in_progress`, on the ticket's attempt AND its turn
 * generation. The read-side twin of {@link transitionDeclineReason}'s fence,
 * for a holder that checks before it writes (the request-end check, a
 * dispatch's gate, an advisory write-back): two turns can share an attempt,
 * so an attempt-only check passes a stale turn.
 */
export function ticketClaimsRow(ticket: TaskClaimTicket, collectionId: string, task: Task | undefined): task is Task {
  return (
    task !== undefined &&
    ticketNamesTask(ticket, collectionId, task) &&
    task.status === "in_progress" &&
    task.attempts === ticket.attempt &&
    (task.turn ?? 0) === ticket.turn
  );
}

/**
 * Refuse a removed option loudly rather than ignoring it (BP-030).
 *
 * `expectAttempt` was replaced by `claim` in FIX-981. TypeScript catches the
 * migration for a typed caller, but an untyped one — plain JS, a `as any`, an
 * options object assembled from config — would otherwise have its guard
 * silently dropped and its write proceed unguarded. Silence is the exact shape
 * of the defect the ticket exists to close, so a leftover key throws.
 *
 * `in` rather than a value check on purpose: `{ expectAttempt: undefined }` is
 * still a caller that thinks it is passing this guard.
 */
function assertNoRemovedGuards(options: TaskTransitionOptions): void {
  if ("expectAttempt" in options) {
    throw new Error(
      `[tasks] "expectAttempt" was removed — pass "claim" instead. A bare attempt ` +
        `number names no task, so it is satisfied by any task on the same attempt. ` +
        `Mint a ticket from the task \`claim()\` returned: ` +
        `\`ticketForClaim(collection.collectionId, claimedTask)\`.`
    );
  }
}

/**
 * Decide whether an advisory write should decline, and say **why**
 * (FIX-951; reason reporting added by FIX-976; target binding by FIX-981).
 *
 * **The one convergence point for the ownership guard.** Called from inside
 * each backing's transition wrapper — i.e. inside the atomic write — so the
 * status it reads is the committed one and no caller has to re-derive the state
 * machine from outside the lock. Single-sourced here because the two backings
 * carry separately maintained copies of the wrapper itself, and the *rules*
 * must not drift between them. Every worker-callable transition on both
 * backings passes through this function; a guard added at a call site instead
 * is a guard the next call site will not have.
 *
 * Returns the reason to no-op the write, or `undefined` to proceed.
 *
 * `undefined` says nothing about legality: the wrapper still runs
 * `assertTransitionAllowed`, so a caller that passed no guards (or only a
 * `claim`) keeps today's throwing contract.
 *
 * ## The evaluation order is the contract
 *
 * It *is* the documented precedence (`terminal` → `not-my-task` → `disallowed`
 * → `lost-claim`, see `TaskWriteDeclineReason`), and the middle two are ordered
 * deliberately rather than incidentally.
 *
 * A decline aborts the write **before** it is attempted, so the conditional
 * write never conflicts, never refreshes, and never re-runs this predicate.
 * "Inside the atomic write" therefore buys freshness against *other writers
 * mid-flight*, not against a basis the caller resolved minutes ago. Two arms
 * are sound under a stale basis anyway — `not-my-task` reads no mutable task
 * state, and terminality is absorbing, so a task observed terminal on any basis
 * is terminal on every later one. `disallowed` is not: a stale `pending` makes
 * an ordinary `in_progress → completed` settlement look illegal. Leaving the
 * ownership arm last would therefore report `disallowed` for one interleaving
 * of a cross-task write and `not-my-task` for another — the same defect refused
 * for a reason that happens to be available, which no caller can act on and no
 * model can correct itself from.
 *
 * The terminal and disallowed arms remain separate for the FIX-951 reason:
 * `isTransitionAllowed` treats same-status as allowed, so `cancelled →
 * cancelled` is legal *and* terminal, and letting it through would clobber the
 * reason and timestamp of the settlement already recorded.
 *
 * This is the **transition** hook. The assignment terminal guard is a separate
 * patch-hook on the patch helper (FIX-976 / epic constraint A1) and deliberately
 * not a further arm here: `setAssignee` never travels this path.
 *
 * ## The lease fence (FIX-1005)
 *
 * The last arm is the holder's half of {@link leaseLapsed}. A ticket-fenced
 * write on an `in_progress` row whose lease has already gone is declined
 * `lost-claim` — the reason it already is, not a new one.
 *
 * This is what makes the lease a promise rather than a hope. `isClaimable`'s
 * recovery arm and this arm are **two readings of one subtraction**, both
 * evaluated on the committed row inside the same atomic write, so a row is
 * either still the claimant's or already the queue's and the two sides cannot
 * drift. It closes three holes at once: a renewal that commits after the lease
 * it held cannot install a deadline on a row nobody holds, a settlement from a
 * worker that ran past its lease is refused, and a rescue path's `fail()`
 * after a lost lease is refused so the row stays recoverable instead of being
 * terminalized `errored` by our own liveness mechanism.
 *
 * Its one opt-out is `adoptLapsedLease` on a renewal (FIX-1305): a claimant
 * that has not started yet takes the row back rather than being refused, and
 * because every other arm still runs, "took it back" and "lost it" are decided
 * by this same write. See the option for why only the caller can tell the two
 * lapsed claimants apart.
 *
 * @param collectionId The board this write is happening on — compared against
 *   the ticket's, because two boards may both hold a task id.
 * @param now The clock the write is running against. Both backings already
 *   have one in scope at the call site; taking it as a parameter rather than
 *   capturing `Date.now` is what keeps this testable with an injected clock.
 */
export function transitionDeclineReason(
  task: Task,
  targetStatus: TaskStatus,
  options: TaskTransitionOptions | undefined,
  collectionId: string,
  now: number,
  changeKind?: TaskChangeKind
): TaskWriteDeclineReason | undefined {
  // FIX-2133: a held row settles only by cancel, whoever writes, guarded or
  // not. Its holds close first: an answer, a deadline, or the cancel itself.
  if (
    changeKind !== undefined &&
    SETTLEMENT_CHANGE_KINDS.has(changeKind) &&
    !isTerminalStatus(task.status) &&
    hasOpenQuestion(task)
  ) {
    return "open-question";
  }
  if (options === undefined) return undefined;
  assertNoRemovedGuards(options);
  const claim = options.claim;
  if (options.ifAllowed === true && isTerminalStatus(task.status)) return "terminal";
  // FIX-2133: a confirm's No cancels only while its confirm is open, on the committed row.
  const whileQuestionOpen = (options as { whileQuestionOpen?: string }).whileQuestionOpen;
  if (whileQuestionOpen !== undefined) {
    const hold = task.questions?.find((h) => h.id === whileQuestionOpen);
    if (hold === undefined || !isRowQuestion(hold)) return "no-such-question";
    if (answerOf(task, whileQuestionOpen) !== undefined) return "answered";
  }
  if (claim !== undefined && !ticketNamesTask(claim, collectionId, task)) return "not-my-task";
  // FIX-2133, at the settle (FIX-2132): a turn that asked midway settles nothing on its own
  // claim, answered or not. An answer closes the hold but leaves the asking turn's ticket valid
  // until the next claim, and the turn it owes is the one that settles.
  if (
    claim !== undefined &&
    changeKind !== undefined &&
    SETTLEMENT_CHANGE_KINDS.has(changeKind) &&
    !isTerminalStatus(task.status) &&
    askedOnTicket(task, claim) &&
    (task.turn ?? 0) === claim.turn
  ) {
    return "open-question";
  }
  if (options.ifAllowed === true && !isTransitionAllowed(task.status, targetStatus)) {
    return "disallowed";
  }
  if (claim !== undefined && !attemptOwnsTask(task, claim.attempt)) return "lost-claim";
  // FIX-2133 D3: two turns can share an attempt, so the ticket's turn
  // generation must be the row's too. A turn's late write after its
  // successor's claim is refused as a lost claim, as a reclaimed attempt's is.
  if (claim !== undefined && claim.turn !== (task.turn ?? 0)) return "lost-claim";
  // FIX-1305: a renewal may be the ticket-holder taking the row BACK, rather
  // than a late write against a row it has lost. The two are the same evidence
  // — everything above passed, so the identity the ticket names is still the
  // row's and nobody has reclaimed it — and only the caller knows which one it
  // is, so it says (`adoptLapsedLease`).
  //
  // Scoped to a renewal, and that scope is structural rather than a promise:
  // `renewLease` and `linkRun` are the only writes that target `in_progress`,
  // and only a renewal is handed the flag by the substrate's own callers, so a
  // settlement carrying it is unaffected and a lapsed worker's result is still
  // refused. Nothing else about the write changes — a reclaim that moved
  // `attempts` or the status has already declined one arm up, which is what
  // makes the takeover decided by the race instead of by the clock.
  const adopting = options.adoptLapsedLease === true && targetStatus === "in_progress";
  if (claim !== undefined && !adopting && leaseLapsed(task, now)) return "lost-claim";
  // FIX-2133: a renewal (any open hold), or a mirror of a run's stop (an open
  // row hold: one source at a time), refused on the committed row.
  if (options.refuseWithOpenQuestion === "any" && hasOpenQuestion(task)) return "open-question";
  if (options.refuseWithOpenQuestion === "row" && openRowQuestions(task).length > 0) return "open-question";
  // Last: a write from an attempt that lost the row is refused as that, never
  // as owing a steer the row's next attempt holds (FIX-2086).
  if (options.refuseUntakenSteers === true && targetStatus === "completed" && untakenSteers(task).length > 0) {
    return "untaken-steers";
  }
  return undefined;
}

/**
 * True when every dep on `task` is `completed`. Used by both the
 * default collection eligibility predicate and the dispatcher
 * eligibility variants.
 *
 * `lookup` reads the freshest task by id — pass `(id) =>
 * collection.get(id)` for the dispatcher case so dep status reflects
 * the latest committed state, not a scan-time snapshot.
 */
function depsSatisfied(
  task: Task,
  lookup: (id: string) => Task | undefined
): boolean {
  if (task.deps === undefined || task.deps.length === 0) return true;
  for (const depId of task.deps) {
    const dep = lookup(depId);
    if (dep === undefined || dep.status !== "completed") return false;
  }
  return true;
}

/**
 * The one subtraction this whole mechanism rests on (FIX-1005): an
 * `in_progress` row whose lease deadline has already passed.
 *
 * **One fact, two readings.** The queue reads it as *"this row is available"*
 * ({@link isClaimable}); the holder reads it as *"this row is no longer mine"*
 * ({@link transitionDeclineReason}'s fence). They are the same comparison on
 * the same committed row, so nothing has to be scheduled and nothing has to
 * agree with anything — there is no window between them to get wrong.
 *
 * **Scoped to `in_progress` on purpose:** the lease governs a running row and
 * nothing else.
 *
 * `!= null` rather than truthiness: a row persisted without a lease is not a
 * lapsed one (BP-030).
 */
export function leaseLapsed(task: Task, now: number): boolean {
  if (task.status !== "in_progress") return false;
  return task.leaseUntil != null && task.leaseUntil <= now;
}

/**
 * The lease duration the claim **committed to** — how long the claimant may be
 * gone, as the claim wrote it, not how much of it is left.
 *
 * The one number two mechanisms both rest on, which is why it is a function
 * rather than a line in each of them: the renewal driver derives its cadence
 * from it ({@link startLeaseRenewal}), and a claimant taking a lapsed row back
 * renews for it, so the two would disagree the moment either copy was edited.
 * Not the lease that is *left* — that is `leaseUntil - now`, a different
 * number, and conflating them shrinks a late-starting driver's cadence to a
 * write storm.
 *
 * **Read from `leaseDurationMs`, with `leaseUntil - updatedAt` as the fallback
 * for a row claimed before that field existed (BP-030).** The subtraction is
 * exact only at the instant of the claim, which is what made storing the
 * number necessary: `setPriority`, `addLabel`, `removeLabel` and
 * `patchMetadata` are supported on an `in_progress` row and all move
 * `updatedAt` while leaving `leaseUntil` alone, so on a legacy row a
 * coordinator's relabel shortens what this reports — and past the deadline
 * drives it non-positive. Both consumers treat that as "cannot reason about
 * this row" rather than as a short lease, which is the same conservative
 * answer those rows got before this field existed.
 *
 * `undefined` when the row holds no lease deadline — nothing is claiming to be
 * alive on it, so there is no committed span to report even if the duration a
 * past claim wrote is still on the row. A non-positive result is returned
 * as-is; what to do about it is the caller's: the driver goes inert, the
 * takeover refuses.
 */
export function committedLeaseSpan(task: Task): number | undefined {
  if (task.leaseUntil == null) return undefined;
  if (task.leaseDurationMs != null) return task.leaseDurationMs;
  return task.leaseUntil - task.updatedAt;
}

/**
 * True when `task` is ready to be claimed: status is `pending` and
 * deps are satisfied.
 *
 * Kept as the narrower "never been started" question. Since FIX-1005 the
 * substrate's admission test is {@link isClaimable}, which is this **plus**
 * a row whose worker died — dispatchers that used to spell out `isReady`
 * dropped the conjunct rather than widening it, because widening three copies
 * separately is the drift the shared predicate exists to prevent.
 */
export function isReady(
  task: Task,
  lookup: (id: string) => Task | undefined
): boolean {
  if (task.status !== "pending" || hasOpenQuestion(task)) return false;
  return depsSatisfied(task, lookup);
}

/**
 * **The one admission predicate** — "should the claim path look at this row?"
 * (FIX-1005).
 *
 * Shared by all three producers that used to answer it independently: the
 * claim path, the board's wake probe (`task-board/shared.ts`), and the
 * ready-task preview (`blocks/select-next-ready-task.ts`). Move a subset and a
 * board recovers rows it never wakes for, or wakes for work it will not take.
 *
 * It answers **admission only**. What to *do* with an admitted row —
 * re-dispatch it, or settle it because its abandonment allowance is spent — is
 * {@link claimDisposition}'s question, decided inside the atomic write against
 * committed state. Folding disposition in here is what produced an earlier
 * contradiction: both backings filter candidates through eligibility *before*
 * the write, so a row the predicate excluded could never reach the branch that
 * was supposed to settle it.
 *
 * There is deliberately **no attempts arm**. `maxAttempts` is optional and
 * `shouldRetryOnFail` returns `false` without one, so an "attempts remain" arm
 * would make an ordinary task unrecoverable after its first attempt — the
 * feature off by default unless every caller opted into retries.
 *
 * A held row (FIX-2080) is never admitted, whichever board or dispatcher
 * drains the collection: `held` is not `pending`, so it starts only once
 * something releases it. Nor is a row with an open hold (FIX-2133): a
 * question, a confirm, or a task run's stop for a person. A running row that
 * owes a turn on its same attempt (`owesTurn`: its last question answered,
 * or a steer no request took) is: the claim is that turn's start.
 *
 * `now` is a parameter rather than a captured clock because the wake probe has
 * none of its own.
 */
export function isClaimable(
  task: Task,
  lookup: (id: string) => Task | undefined,
  now: number
): boolean {
  // FIX-2133: a row with an open hold is never admitted, before its start or
  // midway; a running row that owes a turn on its same attempt is (D3).
  if (hasOpenQuestion(task)) return false;
  if (task.status !== "pending" && !leaseLapsed(task, now) && !owesTurn(task)) return false;
  return depsSatisfied(task, lookup);
}

/**
 * What the claim write should do with a row {@link isClaimable} admitted
 * (FIX-1005) — evaluated **inside** the atomic write, against committed state.
 *
 * - `claim` — hand it out. The ordinary case, and every `pending` row.
 * - `settle-abandoned` — its worker died more times than the allowance
 *   permits, so the write settles it `errored` right here rather than handing
 *   out another duplicate execution. Settling *in the claim write* is what
 *   keeps the deadlock closed: a row left `in_progress` with nobody on it
 *   still counts as in-flight, and the board would then never report `drained`
 *   or `blocked`.
 */
export function claimDisposition(
  task: Task,
  now: number,
  maxAbandonments: number
): "claim" | "settle-abandoned" {
  if (!leaseLapsed(task, now)) return "claim";
  return readAbandonments(task) < maxAbandonments ? "claim" : "settle-abandoned";
}

/** The error recorded on a row the substrate stopped recovering (FIX-1005). */
function abandonmentExhaustedError(
  taskId: string,
  maxAbandonments: number
): string {
  return (
    `[tasks] task "${taskId}" was abandoned by its worker ${maxAbandonments} times ` +
    `without completing. Not re-dispatched.`
  );
}

/** Default ordering: ascending `createdAt`, stable on tied timestamps via id. */
export function defaultOrder(a: Task, b: Task): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

/**
 * Default lease duration applied when the dispatcher does not pass one through.
 *
 * **Two minutes (FIX-1005).** Duplicate side effects are the expensive failure
 * and slow recovery is the cheap one. At `RENEWAL_DIVISOR = 3` this puts
 * renewals 40 s apart and one missed renewal is survivable, so a worker has to
 * be unresponsive for roughly 80 s before it loses its row — which is the band
 * ordinary GC pauses, slow disks and paused containers actually fall in. The
 * cost is that a genuinely dead job waits up to two minutes to come back;
 * callers who want it sooner pass a shorter lease per claim.
 *
 * A **default**, not a guard: {@link assertValidLeaseDuration} still validates
 * whatever a caller passes, and a caller passing its own lease is unaffected.
 */
export const DEFAULT_LEASE_DURATION_MS = 120_000;

/**
 * Floor on a caller-supplied lease (FIX-1005).
 *
 * The renewal cadence is derived from the lease (`span / RENEWAL_DIVISOR`), so
 * one minimum stated in the caller's own units subsumes a separate cadence
 * floor: there is one number to justify instead of two.
 */
export const MIN_LEASE_DURATION_MS = 1_000;

/**
 * Ceiling on a caller-supplied lease (FIX-1005), and it exists for the same
 * reason the floor does.
 *
 * `setTimeout` coerces a delay past a 32-bit signed integer to **1 ms** (with a
 * `TimeoutOverflowWarning`), so a lease past `TIMEOUT_MAX × RENEWAL_DIVISOR`
 * would rebuild the renewal write storm the floor exists to prevent — out of a
 * lease nobody would call invalid. About 74.5 days.
 */
export const MAX_LEASE_DURATION_MS = 2_147_483_647 * 3;

/**
 * Refuse a lease duration outside its permissible domain (FIX-1005).
 *
 * **Throws rather than declining or normalizing**, reusing this repo's stated
 * posture for a numeric argument outside its domain (`RequestStore`'s
 * `expectedVersion`, `engine/src/stores/types.ts`): it is a programming error,
 * not a runtime condition and not a lost race, so it is never folded into a
 * write verdict. Normalizing silently is the worse option — a caller who asked
 * for a 10 ms lease and got 1,000 ms has been given a different guarantee than
 * the one they asked for.
 */
export function assertValidLeaseDuration(leaseDurationMs: number): void {
  if (!Number.isFinite(leaseDurationMs)) {
    throw new Error(
      `[tasks] leaseDurationMs must be a finite number, got ${String(leaseDurationMs)}.`
    );
  }
  if (leaseDurationMs < MIN_LEASE_DURATION_MS) {
    throw new Error(
      `[tasks] leaseDurationMs must be at least ${MIN_LEASE_DURATION_MS}ms, got ` +
        `${leaseDurationMs}ms. The lease is how long a worker may be gone before its ` +
        `work is handed to someone else; below this the renewal cadence it implies is ` +
        `a write storm.`
    );
  }
  if (leaseDurationMs > MAX_LEASE_DURATION_MS) {
    throw new Error(
      `[tasks] leaseDurationMs must be at most ${MAX_LEASE_DURATION_MS}ms, got ` +
        `${leaseDurationMs}ms. A longer lease overflows the renewal timer's delay, ` +
        `which the platform then coerces to 1ms.`
    );
  }
}

/**
 * Refuse a renewal deadline outside its permissible domain (FIX-1005).
 *
 * Same posture as {@link assertValidLeaseDuration}, and deliberately the same
 * rule rather than a second convention: the claim seam validates a *duration*
 * and cannot constrain the *absolute* deadline the renewal verb takes, so the
 * verb validates its own input at its own seam.
 */
export function assertValidLeaseDeadline(leaseUntil: number): void {
  if (!Number.isFinite(leaseUntil)) {
    throw new Error(
      `[tasks] renewLease requires a finite absolute deadline, got ${String(leaseUntil)}.`
    );
  }
}

/**
 * The guards a `linkRun` write runs under, and the refusal of an unfenced one
 * (FIX-1668). Shared so the two backings cannot drift.
 *
 * Renewal's guards exactly — `ifAllowed` forced on, so a settled row declines
 * `terminal` instead of throwing — minus `adoptLapsedLease`. That option is
 * scoped to writes targeting `in_progress`, which a link write also targets;
 * dropping it keeps the lease fence on: a lapsed claimant takes the row back
 * with a renewal first, and only then links.
 *
 * @throws when no ticket is presented — a programming error, not a lost race.
 */
export function linkRunGuards(
  options: TaskTransitionOptions & { claim?: TaskClaimTicket }
): TaskTransitionOptions {
  requireClaimTicket(
    options?.claim,
    "linkRun",
    `of the attempt it links. The link names the run working the task, so an ` +
      `unfenced write could point any task at any run.`
  );
  const { adoptLapsedLease: _dropped, ...guards } = options;
  return { ...guards, ifAllowed: true };
}

/**
 * Refuse a fenced verb called without the claim ticket it is fenced by.
 * Shared by `renewLease` and `linkRun` in both backings, so the next fenced
 * verb has one place to take its refusal from.
 *
 * @param detail completes "`<verb>` requires the claim ticket …": which ticket,
 *   and why an unfenced call is refused.
 * @throws when `claim` is absent — a programming error, not a lost race.
 */
/** The `requireClaimTicket` detail both backings' `renewLease` refuse with. */
export const RENEW_LEASE_TICKET_DETAIL =
  `the lease belongs to. Renewal is the holder asserting it is still alive, so an ` +
  `unfenced renewal would let anything keep anyone's lease open.`;

export function requireClaimTicket(
  claim: TaskClaimTicket | undefined,
  verb: string,
  detail: string
): asserts claim is TaskClaimTicket {
  if (claim === undefined) {
    throw new Error(`[tasks] ${verb} requires the claim ticket ${detail}`);
  }
}

/**
 * The patch `setKeptOpenBy` writes (FIX-2077): set, with the request's answer
 * kept by {@link completionPatch}'s output rule and no lease unless one is
 * given; or cleared, with the lease the admission starts.
 *
 * FIX-2133: with `hold`, a task run's stop for a person is mirrored on the
 * row as a suspension hold, in the same write (the caller's guard refuses it
 * on a row with an open row hold). Cleared with `resume`, the run's own
 * resume closes that mirror; a later request admitted while the run stays
 * parked leaves it. A clear that takes a turn the row owes (`turnOwed`: its
 * last question answered, or a steer no request took) is that turn's claim: it
 * advances the turn generation and clears the mark. Set with `owesTurn`, the
 * wait is a turn owed (FIX-2086's steer turn), which the claim may take.
 *
 * @throws when clearing without a finite `leaseUntil`: a programming error.
 */
export function waitingOnPatch(
  task: Task,
  keptOpenBy: Task["keptOpenBy"],
  options: { leaseUntil?: number; answer?: { output: unknown }; question?: SuspensionQuestion; resume?: boolean; owesTurn?: boolean }
): Partial<Task> {
  if (keptOpenBy == null) {
    assertValidLeaseDeadline(options.leaseUntil ?? Number.NaN);
    const resumed = options.resume === true ? questionWrite(task, { op: "resume" }) : "unchanged";
    const takesTurn = task.turnOwed === true;
    return {
      keptOpenBy: undefined,
      leaseUntil: options.leaseUntil,
      ...(typeof resumed === "object" && "patch" in resumed ? resumed.patch : {}),
      ...(takesTurn ? { turn: (task.turn ?? 0) + 1, turnOwed: undefined } : {}),
    };
  }
  // The output a completion would write now, and only that (D3): a
  // checkpoint stays the output, and the answer is kept only where the
  // completion would write it. One rule, read from `completionPatch`.
  const kept: Partial<Task> = {};
  if (options.answer !== undefined) {
    const done = completionPatch(task, options.answer.output, task.updatedAt) as Record<string, unknown>;
    for (const key of ["output", "checkpointed", "checkpointAttempt"] as const) {
      if (key in done) (kept as Record<string, unknown>)[key] = done[key];
    }
  }
  // A stop for a person, mirrored in the same write (FIX-2133); any other wait mirrors nothing.
  const mirrored = options.question === undefined ? "unchanged" : questionWrite(task, { op: "mirror", hold: options.question });
  return {
    keptOpenBy: keptOpenBy,
    leaseUntil: options.leaseUntil,
    ...kept,
    ...(typeof mirrored === "object" && "patch" in mirrored ? mirrored.patch : {}),
    ...(options.owesTurn === true ? { turnOwed: true as const } : {}),
  };
}

/** Whether a progress report names anything to write. */
export function reportsProgress(progress: { statusNote?: string; output?: unknown }): boolean {
  return progress.statusNote !== undefined || progress.output !== undefined;
}

/** The patch a progress report writes (FIX-2081): the note, and the output marked a checkpoint. */
export function progressPatch(progress: { statusNote?: string; output?: unknown }): Partial<Task> {
  return {
    ...(progress.statusNote !== undefined ? { statusNote: progress.statusNote } : {}),
    ...(progress.output !== undefined ? { output: progress.output, checkpointed: true as const } : {}),
  };
}

/**
 * The patch a completion writes (FIX-2081, D3): the latest checkpoint is the
 * output, so the final result is written only when no checkpoint was ever
 * made. A failed attempt or a reclaim keeps the checkpoint.
 */
export function completionPatch(task: Task, output: unknown, completedAt: number): Partial<Task> {
  return {
    ...(task.checkpointed === true ? {} : { output }),
    completedAt,
    leaseUntil: undefined,
    claimedBy: undefined,
    error: undefined,
  };
}

/**
 * The patch a cancel writes. `via` is how it was made, when the caller says
 * (FIX-2081): server-set, never input.
 */
export function cancelPatch(
  reason: string | undefined,
  via: Task["cancelledVia"],
  completedAt: number,
): Partial<Task> {
  return {
    ...(reason !== undefined ? { error: reason } : {}),
    completedAt,
    leaseUntil: undefined,
    claimedBy: undefined,
    ...(via !== undefined ? { cancelledVia: via } : {}),
  };
}

/** Copy a run link field by field, so no extra key a caller passed rides into the row. */
export function runLinkPatch(run: TaskRunLink): { run: TaskRunLink } {
  return {
    run: {
      sessionId: run.sessionId,
      requestId: run.requestId,
      attempt: run.attempt,
      ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    },
  };
}

/**
 * Apply a `claim` to a task — flip status, stamp lease, increment attempts,
 * and record where this attempt is running (FIX-1005).
 *
 * Note: `task.assignee` is the worker-registry key (set at task creation by
 * the user), not the runtime worker identity. `claim`'s `workerId` is for
 * trace attribution; the lease itself is `leaseUntil`. So we don't touch
 * `task.assignee` here.
 *
 * `claimedBy` takes a **narrowed** identity rather than a `BlockContext` on
 * purpose: the write path has no business holding a context, and a plain value
 * is what makes the field testable without one.
 *
 * It is written **unconditionally** — set when the caller has an identity,
 * cleared when it does not. A conditional spread would be wrong here even
 * though it reads as the careful option: `claimedBy` is written onto a spread
 * of the *incoming* task, so adding nothing leaves the previous attempt's
 * coordinate in place, now paired with a fresh attempt and a fresh lease. That
 * is worse than absent, because absent is a state readers are told to expect
 * and handle (BP-030) while a stale coordinate reads as current. Clearing with
 * `undefined` is the same shape the claim-clear sites use.
 *
 * `startedAt` is the deliberate contrast a few lines down: it *does* inherit,
 * because it answers "when did work on this task first begin", which a
 * re-claim does not change.
 *
 * `incarnationId` (FIX-989) inherits too, and for the same kind of reason —
 * do not "fix" it to match this field. The two are scoped differently:
 * `claimedBy` belongs to one *attempt*, so every claim must re-establish or
 * clear it, while `incarnationId` identifies the *row* for its whole life and
 * is minted once at creation. A field that is supposed to outlive the write
 * carrying it forward is correct; a per-attempt field doing so is the bug
 * above.
 */
export function applyClaimToTask<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  now: number,
  leaseDurationMs: number,
  claimedBy?: TaskClaimIdentity
): Task<TInput, TOutput> {
  // A claim that takes back a lapsed row is a RECOVERY, and it is counted
  // (FIX-1005). Counting it here rather than at a separate seam is what keeps
  // the count atomic with the dispatch: the same write that advances
  // `attempts` advances this, so there is no window in which a row has been
  // re-dispatched but not yet charged for it.
  const recovering = leaseLapsed(task as Task, now);
  // A running row that owes a turn (FIX-2133 D3) is taken on its SAME
  // attempt, uncharged: the turn goes on with the work, it doesn't retry it,
  // and its run link stays the attempt's.
  const turnOnly = !recovering && owesTurn(task as Task);
  const attempt = turnOnly ? task.attempts : task.attempts + 1;
  return {
    ...task,
    status: "in_progress",
    attempts: attempt,
    // Every claim advances the turn generation the claim ticket carries (D3).
    turn: (task.turn ?? 0) + 1,
    turnOwed: undefined,
    ...(recovering ? { abandonments: readAbandonments(task as Task) + 1 } : {}),
    startedAt: task.startedAt ?? now,
    leaseUntil: now + leaseDurationMs,
    // The duration this claim committed to, kept beside the deadline it
    // produced (FIX-1305). Every other write to a running row moves
    // `updatedAt`, so the subtraction that used to stand in for this number
    // stops being it the moment a coordinator relabels the task.
    leaseDurationMs,
    claimedBy,
    // The run link belongs to the attempt that wrote it (FIX-1668). A claim
    // starts a new attempt, so it clears the link here — the one place any
    // claim, drain or recovery, on either backing, passes through — and the
    // new attempt's run writes its own at the claim gate. Settlement,
    // retry and abandonment deliberately leave it: a finished task keeps
    // naming the run that worked it. Cleared unconditionally, for the reason
    // `claimedBy` is: a spread that added nothing would carry the previous
    // attempt's run onto this one. A turn's claim keeps its attempt's.
    ...(turnOnly ? {} : { run: undefined }),
    // A claim starts a turn that waits on nothing yet (FIX-2077): a row
    // taken back from a lapsed lease must not carry a wait onto the new
    // attempt, and an owed turn's mark is its claim's to clear.
    keptOpenBy: undefined,
    // The attempt's brief carries every steer (FIX-2086 D1), so the claim
    // marks them all taken by it; one that arrives later is untaken until a
    // request of this attempt reads it. A turn's claim takes its answers so.
    ...(task.steers !== undefined ? { steers: steersForAttempt(task.steers, attempt) } : {}),
    updatedAt: now,
  };
}

/**
 * The patch that settles a row whose abandonment allowance is spent
 * (FIX-1005), applied inside the same claim write that admitted it.
 *
 * `in_progress → errored` is already a legal transition, and clearing the
 * lease and the coordinate matches every other path that ends a claim.
 */
export function applyAbandonmentSettlement<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  now: number,
  maxAbandonments: number,
  recording?: EndingRecording
): Task<TInput, TOutput> {
  return recordEnding(
    task,
    {
      ...task,
      status: "errored",
      error: abandonmentExhaustedError(task.id, maxAbandonments),
      completedAt: now,
      leaseUntil: undefined,
      claimedBy: undefined,
      updatedAt: now,
    },
    recording
  );
}

/**
 * What a write is told beyond its patch about recording an ending: the
 * ledger's own recorder, and the one fact about a park its row can't say.
 */
export interface EndingRecording {
  /**
   * The ledger's declared recorder (`defineTaskCollection({ recordEnding })`).
   * Runs after orchestration's own, and only its `metadata` is kept.
   */
  readonly recordEnding?: TaskEndingRecorder;
  /**
   * Whether this ending owes a cascade (FIX-2080 D2), answered by the backing
   * from the committed board inside the write: a failed or cancelled row with
   * an open dependent, or a task whose board pays the tasks it filed
   * (`cascadeFiled`). Omitted, no ending owes one.
   */
  readonly owesCascade?: (row: Task, ending: TaskEnding) => boolean;
  /**
   * The board hands rows out (FIX-2078): orchestration records the notice an
   * ending owes its filer in the same write (`../notice/task-notice`).
   */
  readonly delivers?: boolean;
  /** The filer made this cancel through its own model's task tool (D2): it owes no notice. */
  readonly ownCancel?: boolean;
  /** For a cascaded cancel: whether the row that caused it shares this row's filer (D2). */
  readonly causeSharesFiler?: (row: Task) => boolean;
}

/**
 * How long after its ending a cascade falls due (FIX-2080 D2): the ending's
 * own pass pays it at once, and a touch of the board pays it once this has
 * passed, so a touch never races the pass that is still paying it.
 */
export const CASCADE_DUE_MS = 2_000;

/**
 * When the ending that owes `owed` was written (FIX-2080 D2): its own stamp,
 * or, on a debt that recorded only its due time, that time less
 * {@link CASCADE_DUE_MS} (BP-030).
 */
export function cascadeEndedAt(owed: NonNullable<Task["cascadeOwed"]>): number {
  return owed.endedAt ?? owed.due - CASCADE_DUE_MS;
}

/**
 * Orchestration's cascade recorder (FIX-2080 D2): stamp the cascade owed,
 * due {@link CASCADE_DUE_MS} after the write, on an ending that owes one.
 * Recorded in the ending's own write, so a crash between the ending and the
 * cascade leaves it owed, not lost.
 */
function recordCascadeOwed<TInput, TOutput>(
  row: Task<TInput, TOutput>,
  ending: TaskEnding,
  recording: EndingRecording | undefined
): Task<TInput, TOutput> {
  if (recording?.owesCascade?.(row as Task, ending) !== true) return row;
  return { ...row, cascadeOwed: { due: row.updatedAt + CASCADE_DUE_MS, endedAt: row.updatedAt } };
}

/**
 * The one ending signal (FIX-1794 P2 with FIX-1816). Every write that changes a
 * row goes through {@link applyTransition} or {@link applyAbandonmentSettlement},
 * on both backings, so this is where an ending is detected, once, and where
 * every recorder runs, in that same write:
 *
 * 1. Orchestration's own: {@link recordResumeOwed}, which writes the typed
 *    `Task.resumeOwed` on a waited-on row's ending, and
 *    {@link recordCascadeOwed}, which writes `Task.cascadeOwed` on one that
 *    owes a cascade.
 * 2. The ledger's declared `recordEnding`, handed the {@link endingOf} this
 *    write, metadata only.
 *
 * Nothing else records an ending, so none is recorded twice.
 */
function recordEnding<TInput, TOutput>(
  prev: Task<TInput, TOutput>,
  next: Task<TInput, TOutput>,
  recording: EndingRecording | undefined
): Task<TInput, TOutput> {
  const resumed = recordResumeOwed(prev, next);
  const ending = endingOf(prev as Task, next as Task);
  if (ending === undefined) return resumed;
  const owed = recordCascadeOwed(resumed, ending, recording);
  const noticed =
    recording?.delivers === true
      ? (recordNoticeOwed(owed as Task, ending, {
          ...(recording.ownCancel === true ? { ownCancel: true } : {}),
          ...(recording.causeSharesFiler !== undefined
            ? { causeSharesFiler: recording.causeSharesFiler(owed as Task) }
            : {}),
        }) as Task<TInput, TOutput>)
      : owed;
  return applyEndingRecorder(recording?.recordEnding, noticed, ending);
}

/**
 * Orchestration's resume recorder (FIX-1816): stamp the resume-owed marker
 * when this write ends a waited-on row.
 *
 * Every way a waited-on row can end (its worker's result, a failure past its
 * retries, a cancel, the cancel its wait's timeout writes, the board's
 * abandonment settle) reaches it in the same write as the ending. A retried
 * failure re-pends the row, which is not an ending, and writes nothing.
 *
 * A row that owes its cancel (`Task.cancelOwed`, FIX-1844) has a wait that is
 * already over: its ending pays that debt and owes no resume, as no turn waits.
 */
function recordResumeOwed<TInput, TOutput>(
  prev: Task<TInput, TOutput>,
  next: Task<TInput, TOutput>
): Task<TInput, TOutput> {
  if (isTerminalStatus(prev.status) || !isTerminalStatus(next.status)) return next;
  // The row's own run is parked on a stop for a person (FIX-2129): its ending
  // (a cancel, a cascade) owes that run its `cancelled` resume, paid to the
  // stop the row's mirror names, which stays until it is (FIX-2133). The
  // mirror stays while a later request runs for the task (a notice), with
  // `keptOpenBy` cleared, and so does what its ending owes.
  const kept = keptOnEnding(prev as Task, next as Task);
  const owed = kept === undefined ? next : ({ ...next, ...kept } as Task<TInput, TOutput>);
  // A lapsed slot has nobody parked on it (FIX-2082): its ending is held for
  // the request that waited instead (`recordNoticeOwed`).
  if (prev.wait == null || prev.wait.lapsed === true) return owed;
  if (prev.cancelOwed === true) return { ...owed, cancelOwed: undefined };
  return { ...owed, resumeOwed: true };
}

/**
 * Apply a generic field-level patch + status transition to a task, and
 * record the ending it writes, if any ({@link recordEnding}). Does not
 * validate the transition itself — callers run `assertTransitionAllowed`
 * inside the CAS mutator.
 */
export function applyTransition<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  patch: Partial<Task<TInput, TOutput>>,
  now: number,
  recording?: EndingRecording
): Task<TInput, TOutput> {
  const next = { ...task, ...patch, updatedAt: now };
  // A row waits on something only while it runs (FIX-2077): every write that
  // moves it off `in_progress` clears the field.
  if (next.keptOpenBy != null && next.status !== "in_progress") next.keptOpenBy = undefined;
  // So is a turn owed on the same attempt (FIX-2133): only a running row owes one.
  if (next.turnOwed === true && next.status !== "in_progress") next.turnOwed = undefined;
  const recorded = recordEnding(task, next, recording);
  // A task run's mirror stays only while the row runs, or while the cancel's
  // resume is owed (FIX-2129): that debt is paid to the stop it names.
  const dropped = droppedMirror(recorded as Task);
  return dropped === undefined ? recorded : ({ ...recorded, ...dropped } as Task<TInput, TOutput>);
}

/** Filter and clone tasks for query results — keeps consumers from mutating internal state. */
export function listTasks<TInput, TOutput>(
  tasks: ReadonlyArray<Task<TInput, TOutput>>,
  filter?: TaskFilter
): Task<TInput, TOutput>[] {
  return tasks.filter((task) => matchesFilter(task, filter));
}
