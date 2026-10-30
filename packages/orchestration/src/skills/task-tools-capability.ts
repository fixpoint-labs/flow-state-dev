/**
 * `taskTools` capability — the model's surface onto a task board.
 *
 * The filer's four task tools (FIX-2081): `createTask` files a task,
 * `getTask` reads one whole, `listTasks` lists them without results, and
 * `updateTask` changes one, each field by its one rule (the field table,
 * `TASK_FIELD_RULES`): edits, a hold and a release before the task first
 * starts; a cancel and a message until it finishes; nothing after. A message
 * steers (FIX-2086): it is kept on the task, joins its brief, and reaches a
 * running request before its next model call, using no attempt. Every refusal
 * names the field, the state and the next move. A finished task's output never
 * changes: more work is a follow-up, and the task view reads the latest
 * completed follow-up as `current`. A question a task holds on is answered
 * with `updateTask({ id, answers, message })` (FIX-2133).
 *
 * Nothing on this surface settles a task: a task ends when its worker returns
 * or throws, and the drain or the claim gate records that. The worker's own
 * tools act on the row the turn's claim holds, never on a task id from input:
 * `reportProgress` (`createReportProgress`) reports a note and a checkpoint of
 * its output while it runs, and `askQuestion` (`createAskQuestion`) asks the
 * user a question the task holds on (FIX-2131). `waitForUser`
 * (`createWaitForUserTool`) stops a turn for the user's approval, review or,
 * on a turn with no task row, input.
 *
 * ## Dispatching (FIX-1875)
 *
 * On a board that starts a ready row at once (`TaskToolsOptions.dispatches`,
 * a conversation's board), `createTask` starts a ready row at once: the board
 * hands it over as soon as it is filed. A held row is released with `updateTask({ id, status: "pending" })`, and a
 * wait is `getTask`'s (FIX-2082).
 *
 * `createTask` starts a task as its start setting says: at once, after its
 * `deps`, or `held` until a release.
 *
 * Board resolution goes through the resolver the caller passes (FIX-918). With
 * no board resolvable, every tool returns
 * `{ ok: false, error: "no_delegation_board" }` rather than throwing.
 *
 * ## Waiting on a task (FIX-1816; `getTask` since FIX-2082)
 *
 * On a request whose host can hold a wait (`canHoldWait`), on a board that
 * resumes waits (`TaskToolsOptions.resumesWaits`), `getTask` takes two more
 * flat fields: `wait`, which parks the request until the task ends or the
 * deadline passes, and `deadline`, in ms from the call. It returns the task
 * as `getTask` always does: its status says whether it ended. The deadline
 * cancels nothing. A request working a task may wait too, up to five deep.
 * Anywhere else the fields are not in the schema, and either is refused by
 * name. The `getTask_<board>` action never waits: an action has no request to
 * park. `createTask` never waits: it only files, and refuses a wait field by
 * name rather than letting the schema drop it.
 */

import { defineCapability, handler, SuspensionTimeoutError, type DefinedCapability } from "@flow-state-dev/core";
import type { ActionConfig, BlockContext, ReadConfig } from "@flow-state-dev/core/types";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import {
  ticketForClaim,
  isTerminalStatus,
  lockedFields,
  taskSchema,
  taskSpendView,
  taskSpendViewSchema,
  TaskCapExceededError,
  TaskWriteRefusedError,
  TaskFilingRefusedError,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskEditField,
  type TaskUpdateField,
  type TaskInit,
  type TaskSettingsPatch,
  type TaskStatus,
  type TaskWriteOutcome,
  withoutNoticeMarkers,
  cancelledDependents,
  MAX_STEERS,
  MAX_QUESTION_PROMPT,
  isRowQuestion,
  openQuestions,
  steerPlacesTaken,
  taskQuestionSchema,
  type QuestionAnswer,
  type QuestionInit,
  type RowQuestion,
} from "../tasks";
// The board's per-worker claim seam. A deep import for the same reason
// `shouldRetryOnFail` is one: this surface consumes the seam, it does not widen
// the task-board's public API to advertise it.
import { currentWorkerClaim, currentWorkerTask } from "../task-board/flow-policy-wiring";
// The resolver `taskBoard()` recorded for its handle, read without importing
// the task-board barrel (which imports this module's neighbours).
import { boardResolverOf } from "../task-board/board-resolver";
// The one task-turn test (FIX-1816 BR-5a), owned by the task-board.
import { isTaskTurn } from "../task-board/task-turn";
// One wait on a person per task turn (FIX-2131), and the board's one write that opens a question (FIX-2133).
import { takeTurnWait } from "../task-board/turn-wait";
import { askMidway } from "../task-board/task-request";
import {
  arrivesAsNoticeAnswer,
  canHoldWait,
  deliverHeldEnding,
  toolCallOf,
  waitOnTask,
} from "../tasks/helpers/wait-on-task";
import { cancelAndResume } from "../tasks/helpers/user-stop";

/** A filing's question as the board keeps it: a plain string is a question. */
function askOf(question: string | { kind: "question" | "confirm"; prompt: string; onNo?: "cancel" | "continue" }): QuestionInit {
  if (typeof question === "string") return { kind: "question", prompt: question };
  return { kind: question.kind, prompt: question.prompt, ...(question.onNo !== undefined ? { onNo: question.onNo } : {}) };
}

/**
 * Whether the running request's caller reaches `row` (FIX-2133 D1): the
 * user, tenant and org its filing ran under, compared as the engine compares
 * a request's (`principalOwnsRequest`): the same user, the same tenant (none
 * matching none), and the same org when the row recorded one. Read from the
 * request's verified identity, never input (BP-031). A row filed with no user
 * recorded is decided by tenant and org alone.
 */
function callerReaches(ctx: BlockContext, row: Task): boolean {
  const identity = (ctx as { request?: { identity?: { userId?: string; tenantId?: string; orgId?: string } } }).request?.identity;
  if (row.createdBy !== undefined && identity?.userId !== row.createdBy) return false;
  if ((row.filedUnder?.tenantId ?? undefined) !== (identity?.tenantId ?? undefined)) return false;
  return row.filedUnder?.orgId == null || row.filedUnder.orgId === identity?.orgId;
}

/** Resolves the live TaskCollection a `taskTools` handler mutates. */
export type TaskCollectionResolver = (
  ctx: BlockContext,
) => Promise<TaskCollectionRef | undefined>;

// ---------------------------------------------------------------------------
// Shared error contract
// ---------------------------------------------------------------------------

const noBoardError = { ok: false as const, error: "no_delegation_board" };
const taskNotFoundError = (id: string) => ({ ok: false as const, error: "task_not_found", taskId: id });

/**
 * The longest input or output `getTask` returns, each in characters of its
 * JSON. A tool's output is recorded on the turn (BP-042), so a value past this
 * comes back as its JSON, cut, with `inputCut` or `outputCut` set.
 */
export const READ_OUTPUT_LIMIT = 20_000;

/**
 * Each chain's latest completed follow-up, by its root's id, in one pass over
 * the board (`listTasks` reads every row's from this, not a walk per row).
 */
function latestCompletedByRoot(rows: readonly Task[]): Map<string, Task> {
  const latest = new Map<string, Task>();
  for (const row of rows) {
    if (row.followUpOf === undefined || row.status !== "completed") continue;
    const seen = latest.get(row.followUpOf);
    if (seen === undefined || laterThan(row, seen)) latest.set(row.followUpOf, row);
  }
  return latest;
}

/**
 * Whether `a` completed after `b`, by completion time, then filing time, then
 * id (a follow-up's numbered suffix, read as a number), so two that tie to the
 * millisecond always order the same way.
 */
function laterThan(a: Task, b: Task): boolean {
  const at = a.completedAt ?? a.updatedAt;
  const bt = b.completedAt ?? b.updatedAt;
  if (at !== bt) return at > bt;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id.localeCompare(b.id, undefined, { numeric: true }) > 0;
}

/** `current` as a task view names it: none when it is the task itself. */
function currentFor(task: Task, latest: Task | undefined): Task | undefined {
  return latest === undefined || latest.id === task.id ? undefined : latest;
}

/** `current` as a list row names it: its id only, never its output. */
function withCurrentId(current: Task | undefined): { current?: { id: string } } {
  return current === undefined ? {} : { current: { id: current.id } };
}

/** A value as `getTask` returns it: whole, or its JSON cut to {@link READ_OUTPUT_LIMIT}. */
function readable(value: unknown): { value: unknown; cut: boolean } {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  if (text.length <= READ_OUTPUT_LIMIT) return { value, cut: false };
  return { value: text.slice(0, READ_OUTPUT_LIMIT), cut: true };
}

/**
 * What a running task waits on while no worker holds it (FIX-2077's
 * `keptOpenBy`), and what holds it for the user (FIX-2133): its open holds.
 */
function waitingOf(t: Task) {
  const open = openQuestions(t);
  return {
    ...(t.keptOpenBy != null && t.status === "in_progress" ? { keptOpenBy: t.keptOpenBy } : {}),
    ...(open.length > 0 ? { questions: open } : {}),
  };
}

/** A new row's id, in the board's own shape: twenty hex characters, unique across processes. */
const mintTaskId = (): string => `task_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

/** The filing each board is running, so the next waits for it (FIX-2350). In process: a step's calls share one. */
const filings = new Map<string, Promise<unknown>>();

/** Run `file` once every earlier filing on the same board has ended. */
async function oneFilingAtATime<T>(board: string, file: () => Promise<T>): Promise<T> {
  const before = filings.get(board) ?? Promise.resolve();
  const mine = before.then(file, file);
  const settled = mine.then(
    () => undefined,
    () => undefined
  );
  filings.set(board, settled);
  try {
    return await mine;
  } finally {
    if (filings.get(board) === settled) filings.delete(board);
  }
}

/**
 * One task as `getTask` reads it: every field it returns, with its input,
 * output and metadata each cut to {@link READ_OUTPUT_LIMIT} and flagged when
 * cut. `rows` is the board it is on, read for the latest completed follow-up
 * in its chain (`current`). A read built here is the same read the tool
 * returns, so a framework that hands a model a task's ending as a `getTask`
 * result (workforce's woken turn, FIX-2345) shows the shape the tool would.
 */
export function readTaskView(t: Task, rows: readonly Task[]) {
  const taskInput = t.input === undefined ? undefined : readable(t.input);
  const output = t.output === undefined ? undefined : readable(t.output);
  const metadata = t.metadata === undefined ? undefined : readable(t.metadata);
  const current = currentFor(t, latestCompletedByRoot(rows).get(t.followUpOf ?? t.id));
  const currentOutput = current?.output === undefined ? undefined : readable(current.output);
  return {
    id: t.id,
    goal: t.goal,
    ...(t.title !== undefined ? { title: t.title } : {}),
    status: t.status,
    ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
    ...(t.context !== undefined ? { context: t.context } : {}),
    ...(t.deps !== undefined ? { deps: t.deps } : {}),
    ...(t.priority !== undefined ? { priority: t.priority } : {}),
    ...(t.labels !== undefined ? { labels: t.labels } : {}),
    ...(metadata !== undefined ? { metadata: metadata.value, ...(metadata.cut ? { metadataCut: true as const } : {}) } : {}),
    attempts: t.attempts,
    ...(t.maxAttempts !== undefined ? { maxAttempts: t.maxAttempts } : {}),
    ...(t.session !== undefined ? { session: t.session } : {}),
    ...(t.resultTo !== undefined ? { resultTo: t.resultTo } : {}),
    ...(t.target !== undefined ? { target: t.target } : {}),
    ...(taskInput !== undefined ? { input: taskInput.value, ...(taskInput.cut ? { inputCut: true as const } : {}) } : {}),
    ...(output !== undefined ? { output: output.value, ...(output.cut ? { outputCut: true as const } : {}) } : {}),
    ...(t.checkpointed === true ? { checkpoint: true as const } : {}),
    ...(t.statusNote !== undefined ? { statusNote: t.statusNote } : {}),
    ...(t.error !== undefined ? { error: t.error } : {}),
    ...waitingOf(t),
    ...(t.followUpOf !== undefined ? { followUpOf: t.followUpOf } : {}),
    ...(t.filedByTask !== undefined ? { filedByTask: t.filedByTask } : {}),
    ...(t.run != null ? { run: t.run } : {}),
    ...(t.completedAt != null ? { completedAt: t.completedAt } : {}),
    ...(t.steers !== undefined && t.steers.length > 0
      ? {
          steers: t.steers.map((steer) => ({
            message: steer.message,
            from: steer.from,
            ...(steer.by !== undefined ? { by: steer.by } : {}),
            at: steer.at,
            ...(steer.answers !== undefined ? { answers: steer.answers } : {}),
            taken: steer.takenBy === t.attempts,
          })),
        }
      : {}),
    ...(current !== undefined
      ? {
          current: {
            id: current.id,
            ...(currentOutput !== undefined
              ? { output: currentOutput.value, ...(currentOutput.cut ? { outputCut: true as const } : {}) }
              : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Assignee validation (FIX-924)
// ---------------------------------------------------------------------------
/**
 * The declared participants a board can be assigned to, plus a human-readable
 * rendering for error messages. Supplied by the caller so assignment is checked
 * against the board's real participant registry — the same list the model is
 * told about, so context and validation cannot disagree.
 */
export interface AssigneeRoster {
  /** True when `assignee` names a participant on this board. */
  has(assignee: string): boolean;
  /** Roster rendered for an error message, e.g. `researcher (…), fetch (tool)`. */
  describe(): string;
  /**
   * The one participant a task with no assignee goes to, when there is
   * exactly one; `undefined` otherwise. Optional: a roster without it names
   * no default.
   */
  soleAssignee?(): string | undefined;
}

/**
 * Where the task tools read their roster from: a fixed {@link AssigneeRoster},
 * or a function of the running context that returns one, read on every call
 * that checks an assignee (FIX-1794 T1).
 *
 * The function form is for a board whose team changes while it is in use: an
 * assignee added between two calls is accepted on the second, and one removed
 * is refused. It reads the running context the way a resolver reads its board,
 * so each call is checked against the team its own session has now.
 */
export type AssigneeRosterSource =
  | AssigneeRoster
  | ((ctx: BlockContext) => AssigneeRoster | Promise<AssigneeRoster>);

/** The roster a call is checked against: the fixed one, or the function's answer for this context. */
async function rosterFor(
  source: AssigneeRosterSource | undefined,
  ctx: BlockContext,
): Promise<AssigneeRoster | undefined> {
  return typeof source === "function" ? source(ctx) : source;
}

const unknownAssigneeError = (assignee: string, roster: AssigneeRoster) => ({
  ok: false as const,
  error:
    `unknown_assignee: "${assignee}" is not on this board's team. ` +
    `Available: ${roster.describe()}. Name one of these exactly, or leave ` +
    `assignee unset to run the task on the default worker.`,
});

/**
 * The single gate deciding whether an assignee may be written to a task.
 * Returns an error result when the assignee is invalid, `undefined` when it is
 * fine to proceed.
 *
 * Two shapes pass unchecked, both deliberate:
 *
 * - **No assignee.** An unassigned task is a valid plan — it runs on the board's
 *   default worker (its floor, FIX-940). Reaching the floor by *intent* stays
 *   open; only reaching it by *accident* (a typo) is closed.
 * - **No roster.** A caller that passes none supplies none — there is nothing to validate against, so
 *   validation is inert and every assignee is accepted as before (BP-030:
 *   tolerate the old, roster-less shape).
 *
 * This is the one place the definition of "a valid assignee" lives. FIX-923 /
 * FIX-641 widen it here (to admit an explicit ad-hoc agent spec) rather than
 * scattering the rule across the three tools that call it.
 */
export function checkAssignee(
  assignee: string | undefined,
  roster: AssigneeRoster | undefined,
): { ok: false; error: string } | undefined {
  if (roster === undefined || assignee === undefined) return undefined;
  if (roster.has(assignee)) return undefined;
  return unknownAssigneeError(assignee, roster);
}

/**
 * A wrapping ref's own refusal (FIX-2076) as the soft error the tools answer:
 * its code and its message, naming the task when the write named one.
 */
const refusedError = (err: TaskWriteRefusedError) => ({
  ok: false as const,
  error: `${err.code}: ${err.message}`,
  ...(err.taskId !== undefined ? { taskId: err.taskId } : {}),
});

/** Map a creation-cap breach (FIX-931) onto its distinct soft-error code. */
const capError = (err: TaskCapExceededError) => ({
  ok: false as const,
  error:
    err.cap === "enqueued"
      ? ("enqueued_task_cap_exceeded" as const)
      : ("total_task_cap_exceeded" as const),
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * The one renderer for "this task is finished, so your write was refused"
 * (FIX-976, Decision 6).
 *
 * Every tool that refuses a write to a finished task reports it, and they must
 * not drift into two ways of saying the same thing: one sentence shape, one `snake_case`
 * prefix convention (the one `task_not_found` / `unknown_assignee` already
 * use), and exactly one clause that varies: **what would not change**.
 */
const terminalWriteToolError = (options: {
  /** `snake_case` code leading the `error` string. */
  code: string;
  taskId: string;
  status: TaskStatus;
  /** The varying clause, a full sentence: what about this task will not change. */
  clause: string;
}) => ({
  ok: false as const,
  taskId: options.taskId,
  error:
    `${options.code}: task "${options.taskId}" is ${options.status}, which is terminal. ` +
    `${options.clause} Add a new task instead.`,
});

/** The `clause` for a write that would have moved the task's status. */
const STATUS_CLAUSE = "Its status will not change again.";
/**
 * Map a declined substrate write onto the recoverable result shape (FIX-976,
 * Decision 5). The reason travels inside the `error` string behind a
 * `snake_case` prefix; the result schema is unchanged and gains no `code` field.
 *
 * `clause` names what the attempted write would not have changed, so the model
 * is told about the operation it actually called.
 *
 * **`not-my-task` gets its own branch, like `terminal` does** (FIX-981). The
 * generic path below cannot express it: it receives only the *target* id, the
 * reason and the status, and the one fact that makes this refusal correctable
 * is the task the caller actually **holds**. A model told "the write was
 * refused (not-my-task)" learns nothing it can act on; a model told which task
 * is its own retries against the right id.
 *
 * `claimedTaskId` is present exactly when a ticket was presented, which is exactly
 * when `not-my-task` can be reported — so the branch never renders an empty
 * name.
 *
 * The remaining generic branch covers `disallowed` and `lost-claim`. Both are
 * now reachable: a worker's own ticket goes stale when a lease reclaim hands
 * its task on mid-call.
 */
const declinedWriteToolError = (
  taskId: string,
  declined: Extract<TaskWriteOutcome, { outcome: "declined" }>,
  clause: string,
  claimedTaskId?: string,
) => {
  if (declined.reason === "terminal") {
    return terminalWriteToolError({
      code: "terminal_task_write_declined",
      taskId,
      status: declined.status,
      clause,
    });
  }
  if (declined.reason === "follow-up") {
    return {
      ok: false as const,
      taskId,
      error:
        `follow_up_takes_no_assignee: task "${taskId}" is a follow-up, and it runs in the ` +
        `session of the task it follows, with that task's worker. Its assignee doesn't change. ` +
        `Nothing was written.`,
    };
  }
  if (declined.reason === "not-my-task" && claimedTaskId !== undefined) {
    return {
      ok: false as const,
      taskId,
      error:
        `task_write_declined: you hold task "${claimedTaskId}", not "${taskId}". ` +
        `Nothing was written.`,
    };
  }
  return {
    ok: false as const,
    taskId,
    error:
      `task_write_declined: the write to task "${taskId}" was refused ` +
      `(${declined.reason}); the task is ${declined.status}. ${clause}`,
  };
};

/** Shared output shape for a write by id. */
const okOrError = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
]);

// ---------------------------------------------------------------------------
// Questions and follow-ups (FIX-1817)
// ---------------------------------------------------------------------------

const followUpAssigneeError = (followUpOf: string) => ({
  ok: false as const,
  error:
    `follow_up_takes_no_assignee: a follow-up of "${followUpOf}" runs in that task's session, ` +
    `with its worker, and another worker is another session. Leave assignee unset.`,
});

/**
 * Check a follow-up against the board it is filed on (FIX-1817 BR-20 to
 * BR-25): the named task is on this board (its partition, so another
 * conversation's or user's task is unknown here), and its root ran with a
 * worker, so there is a session to follow up in. A session still busy with
 * another task doesn't refuse it: the follow-up waits, and starts in that
 * session once the open task ends (FIX-2080, the board's one-open-task start
 * test). Answers the root, the first task of the chain, and the worker that
 * root ran on.
 */
function resolveFollowUp(
  collection: TaskCollectionRef,
  followUpOf: string,
): { root: string; assignee: string | undefined; id: string } | { ok: false; error: string } {
  const named = collection.get(followUpOf);
  if (named === undefined) {
    return {
      ok: false as const,
      error: `task_not_found: there is no task "${followUpOf}" on this board to follow up.`,
    };
  }
  const root = named.followUpOf ?? named.id;
  const rootTask = collection.get(root);
  // A follow-up runs in the session its root task ran in, with that worker:
  // a root that never ran (cancelled before anyone took it) or had no worker
  // has no session to follow up in.
  if (rootTask === undefined || rootTask.assignee === undefined || rootTask.run === undefined) {
    return {
      ok: false as const,
      error:
        `follow_up_of_unrun: task "${followUpOf}" never ran with a worker, so there is ` +
        `no session to follow up in. File a new task instead. Nothing was filed.`,
    };
  }
  // The follow-up's id is the root's, with the lowest number no row holds.
  // Two follow-ups filed at once pick the same id, and the ledger's insert
  // takes one id once: the loser is refused, and files again.
  let number = 1;
  while (collection.get(`${root}-f${number}`) !== undefined) number += 1;
  return { root, assignee: rootTask.assignee, id: `${root}-f${number}` };
}

/**
 * Whether an add failed because its id is already on the board: the durable
 * ledger's create refuses a live key (`resource_already_exists`), the state
 * backing throws "already exists". Read structurally, so this module takes no
 * engine dependency.
 */
function isTakenTaskId(err: unknown): boolean {
  if ((err as { code?: unknown } | null)?.code === "resource_already_exists") return true;
  return err instanceof Error && /already exists/.test(err.message);
}

/**
 * The metadata key a row filed under an id picked from the board (a
 * follow-up's) names the call that filed it in (its logical id), so a replay
 * of the call finds its own row and no other. Server-written: a caller's
 * metadata never sets or changes it.
 */
const FILED_BY_CALL_KEY = "filedByCall";

/** A caller's metadata, without the keys only the server writes: the notice markers and {@link FILED_BY_CALL_KEY}. */
function taskToolCallerMetadata(metadata: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { [FILED_BY_CALL_KEY]: _filedBy, ...rest } = withoutNoticeMarkers(metadata) ?? {};
  return rest;
}

/**
 * What a follow-up's add answers when its id was taken by a row filed at the
 * same moment: the follow-up can simply be filed again, under the next id.
 */
function followUpTakenError(id: string) {
  return {
    ok: false as const,
    error: `task_id_taken: another task took the id "${id}" at the same moment. File the follow-up again. Nothing was filed.`,
  };
}

/** Where a task turn's own tools (`askQuestion`, `reportProgress`) read the row the turn holds. */
export interface TaskTurnToolOptions {
  /**
   * The ledger the running task turn's row is on, or `undefined` when this
   * flow can't reach it. Resolve from server-set state only (a task session's
   * birth fields, say), never from input (BP-031).
   */
  resolve: (ctx: BlockContext) => Promise<TaskCollectionRef | undefined>;
}

/** {@link createReportProgress}'s options: where it reads the row the turn holds. */
export type ReportProgressOptions = TaskTurnToolOptions;

/** The row a task turn holds, with the ticket that proves it. */
interface HeldRow {
  readonly claim: TaskClaimTicket;
  readonly ledger: TaskCollectionRef;
  readonly row: Task | undefined;
}

/**
 * The row the running task turn holds, or `undefined` when it holds none.
 *
 * - Inside a board's own drain, the claim its worker body stamped
 *   (`currentWorkerClaim`), on the resolved ledger.
 * - On a dispatched turn, the row whose run link names this session and this
 *   request, on this attempt: the link the receiving gate wrote from the
 *   run's own context, fenced by the claim, before the turn began. The ticket
 *   is minted from that row, as the gate mints its own.
 *
 * So a person's message into a task session, another request, holds no row.
 */
async function claimedRowOf(
  resolve: (ctx: BlockContext) => Promise<TaskCollectionRef | undefined>,
  ctx: BlockContext,
): Promise<HeldRow | undefined> {
  if (!isTaskTurn(ctx)) return undefined;
  const ledger = await resolve(ctx);
  if (ledger === undefined) return undefined;
  const stamped = currentWorkerClaim(ctx);
  if (stamped !== undefined) {
    if (stamped.collectionId !== ledger.collectionId || stamped.partition !== ledger.partition) return undefined;
    return { claim: stamped, ledger, row: ledger.get(stamped.taskId) };
  }
  const sessionId = ctx.session?.identity?.id;
  const requestId = ctx.request?.identity?.id;
  if (sessionId === undefined || requestId === undefined) return undefined;
  // Any status: a row this turn held and that has since settled or been
  // cancelled is still this turn's, and a write declines naming it.
  const row = ledger
    .list()
    .find((task) => task.run?.sessionId === sessionId && task.run.requestId === requestId && task.run.attempt === task.attempts);
  if (row === undefined) return undefined;
  return { claim: ticketForClaim(ledger.collectionId, row, ledger.partition), ledger, row };
}

/** The longest status note `reportProgress` takes, in characters: one line for a task view. */
export const STATUS_NOTE_LIMIT = 280;

/**
 * The worker's one task tool (FIX-2081 D3): `reportProgress({ statusNote?,
 * output? })`, for a task turn, and the rule for when a turn is offered it.
 *
 * - **Which row.** The one the turn holds ({@link claimedRowOf}), never an id
 *   from input, so it takes none: an inline plan step's own row, or a
 *   dispatched row, never the parent.
 * - **What it writes.** `statusNote`, a one-line note for task views, and
 *   `output`, a checkpoint of the result so far. Neither changes the task's
 *   status: done still follows the worker's return, and nothing here settles
 *   the row. The latest checkpoint is the task's output; the final result
 *   becomes the output only when no checkpoint was made.
 * - **The fence.** The collection's claim-fenced `reportProgress`, so a
 *   finished task, a reclaimed attempt or a recreated row declines, and
 *   nothing is written.
 * - **When it is offered** (`offered`). On a task turn holding a running row.
 *
 * Not a public action: a screen doesn't report a worker's progress.
 */
export function createReportProgress(options: ReportProgressOptions) {
  const tool = handler({
    name: "reportProgress",
    description:
      "Report progress on the task you are running: statusNote, a one-line note on where it " +
      "stands, and output, a checkpoint of your result so far. The latest output you report is " +
      "the task's output, so report the whole result so far each time; your final answer becomes " +
      "the output only when you never report one. This doesn't finish the task or change its " +
      "status: the task ends when your turn does.",
    inputSchema: z.object({
      statusNote: z.string().min(1).max(STATUS_NOTE_LIMIT).optional(),
      output: z.unknown().optional(),
    }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), taskId: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (input, ctx) => {
      if (input.statusNote === undefined && input.output === undefined) {
        return {
          ok: false as const,
          error: "progress_takes_a_note_or_output: send statusNote, output, or both. Nothing was written.",
        };
      }
      const held = await claimedRowOf(options.resolve, ctx);
      if (held === undefined) {
        return {
          ok: false as const,
          error: "not_a_task_turn: this turn isn't running a task, so there is no task to report on.",
        };
      }
      const { claim, ledger } = held;
      if (ledger.reportProgress === undefined) {
        return {
          ok: false as const,
          error: `progress_not_supported: task "${claim.taskId}"'s board doesn't take progress reports. Nothing was written.`,
        };
      }
      const outcome: TaskWriteOutcome | undefined = await ledger.reportProgress(
        claim.taskId,
        {
          ...(input.statusNote !== undefined ? { statusNote: input.statusNote } : {}),
          ...(input.output !== undefined ? { output: input.output } : {}),
        },
        { claim },
      );
      if (outcome != null && outcome.outcome === "declined") {
        if (outcome.reason === "terminal") {
          return {
            ok: false as const,
            error:
              `task_finished: task "${claim.taskId}" is ${outcome.status}, so its progress and output ` +
              `no longer change. Nothing was written.`,
          };
        }
        return {
          ok: false as const,
          error:
            `progress_declined: task "${claim.taskId}" is ${outcome.status}, and this turn no longer ` +
            `holds it running (${outcome.reason}). Nothing was written.`,
        };
      }
      return { ok: true as const, taskId: claim.taskId };
    },
  });

  return {
    /** The tool, for a task turn's tool list. */
    tool,
    /** Whether the running turn is offered the tool: a task turn holding a running row. */
    offered: async (ctx: BlockContext): Promise<boolean> => {
      const held = await claimedRowOf(options.resolve, ctx);
      return held !== undefined && held.row?.status === "in_progress";
    },
  };
}

/**
 * The longest question `askQuestion` takes, in characters: what a row keeps
 * of a question (`MAX_QUESTION_PROMPT`), so the person reads the whole of it.
 */
const QUESTION_LIMIT = MAX_QUESTION_PROMPT;

/**
 * The worker's question (FIX-2131, on FIX-2133's hold): `askQuestion({ question })`,
 * for a task turn, and the rule for when a turn is offered it.
 *
 * - **Which row.** The one the turn holds ({@link claimedRowOf}), never a task
 *   id from input.
 * - **The question.** The board's one write that opens it (`askMidway`): it is kept
 *   on the row as a hold, the row's lease is dropped, and the turn ends
 *   unsettled. What the turn did stands; the answer (a steer naming the
 *   question, from the Inbox, a line in the task's session, or the filer's
 *   `updateTask`) owes the task one more turn on the same attempt, which
 *   starts from the brief, the last checkpoint and the answer. Its deadline is
 *   the hold's, which the host sets.
 * - **One wait per turn.** A turn whose `waitForUser` took the turn's wait on a
 *   person first is refused, naming it; and this tool, first, refuses that one.
 *   Both tools take the wait at the same point of their call, before anything
 *   they write, so a durable turn's replay decides as its first run did.
 * - **When it is offered** (`offered`). On a task turn holding a running row.
 */
export function createAskQuestion(options: TaskTurnToolOptions) {
  const tool = handler({
    name: "askQuestion",
    description:
      "Ask the user a question about the task you are running that you can't go on without: " +
      "which region, which account, whether you may delete something. The task waits for their " +
      "answer, and your turn ends: after calling this, end your turn with a short note. Their " +
      "answer starts your next turn on this task, with everything you did so far. Use it instead " +
      "of guessing.",
    inputSchema: z.object({ question: z.string().min(1).max(QUESTION_LIMIT) }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), taskId: z.string(), questionId: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (input, ctx) => {
      const held = await claimedRowOf(options.resolve, ctx);
      if (held === undefined) {
        return {
          ok: false as const,
          error: "not_a_task_turn: this turn isn't running a task, so there is no task to ask about.",
        };
      }
      const { claim, ledger } = held;
      if (takeTurnWait(ctx, held, "askQuestion") === "waitForUser") {
        return {
          ok: false as const,
          error:
            `one_wait_per_turn: this turn already waits on the user with waitForUser, so it can't ` +
            `also ask a question. Ask it after they answer. Nothing was written.`,
        };
      }
      const asked = await askMidway(ctx, ledger, [{ prompt: input.question }]);
      if (asked.ok) return { ok: true as const, taskId: claim.taskId, questionId: asked.questions[0] ?? "" };
      if (asked.reason === "steer-limit") {
        return {
          ok: false as const,
          error:
            `question_limit: task "${claim.taskId}" has no room left for another answer. Go on ` +
            `with what you have. Nothing was written.`,
        };
      }
      const status = ledger.get(claim.taskId)?.status ?? "unknown";
      return {
        ok: false as const,
        error:
          `ask_declined: task "${claim.taskId}" is ${status}, and this turn no longer holds it ` +
          `(${asked.reason}), so it can't wait on your question. Nothing was written.`,
      };
    },
  });

  return {
    /** The tool, for a task turn's tool list. */
    tool,
    /** Whether the running turn is offered the tool: a task turn holding a running row. */
    offered: async (ctx: BlockContext): Promise<boolean> => {
      const held = await claimedRowOf(options.resolve, ctx);
      return held !== undefined && held.row?.status === "in_progress";
    },
  };
}

/** What a model's `waitForUser` asks for: an approval, a review or, on a turn with no task row, input. */
const WAIT_KINDS = ["approval", "review", "input"] as const;

/**
 * The model's stop for the user (FIX-2131, on FIX-2129's `ctx.waitForUser`):
 * `waitForUser({ kind, prompt })`, an approval, a review or an input, and the
 * rule for when a turn is offered it.
 *
 * - **Which kinds where.** On a task turn, approvals and reviews: the request
 *   suspends, the row mirrors the stop as its suspension hold, and the Inbox
 *   lists it. A question on a task turn holds the task instead, so `input` is
 *   refused there by name, pointing at `askQuestion`. On a turn with no task
 *   row there is nothing to hold, so a question is `input`, and its answer is
 *   the tool's result.
 * - **Its deadline** is the host's setting for a person's stop, where the host
 *   sets one, and none otherwise; the tool takes none. A model can't catch, so
 *   at the deadline the tool returns a no-answer result (`answered: false`,
 *   `deadline: true`), and an approval reads as a no.
 * - **One wait per turn.** On a task turn, a turn that asked a question first
 *   is refused, naming `askQuestion`. Read off the turn-asked fact, never off
 *   the row's open holds.
 * - **When it is offered** (`offered`). On any turn of a host that can stop a
 *   request for the user (durable execution, `ctx.suspend`).
 */
export function createWaitForUserTool(options: TaskTurnToolOptions) {
  const tool = handler({
    name: "waitForUser",
    description:
      "Stop and wait for the user. kind approval asks a yes or a no before you do something; " +
      "kind review asks them to look at work and give a verdict; kind input asks for a value you " +
      "need, and is only for a turn that isn't running a task (on a task, use askQuestion). The " +
      "user's answer is this tool's result. It may come back with answered: false when nobody " +
      "answered in time: then go on without it, or end your turn.",
    inputSchema: z.object({
      kind: z.enum(WAIT_KINDS),
      prompt: z.string().min(1),
      title: z.string().min(1).optional(),
    }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), kind: z.literal("approval"), approved: z.boolean(), deadline: z.literal(true).optional(), answer: z.unknown().optional() }),
      z.object({ ok: z.literal(true), kind: z.enum(["review", "input"]), answered: z.literal(true), answer: z.unknown() }),
      z.object({ ok: z.literal(true), kind: z.enum(["review", "input"]), answered: z.literal(false), deadline: z.literal(true) }),
      z.object({ ok: z.literal(true), cancelled: z.literal(true) }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (input, ctx) => {
      const held = await claimedRowOf(options.resolve, ctx);
      if (held !== undefined) {
        if (input.kind === "input") {
          return {
            ok: false as const,
            error:
              `input_is_a_question: you are running task "${held.claim.taskId}", so a question you ` +
              `need answered keeps the task waiting: ask it with askQuestion. Nothing was asked.`,
          };
        }
        if (takeTurnWait(ctx, held, "waitForUser") === "askQuestion") {
          return {
            ok: false as const,
            error:
              `one_wait_per_turn: this turn already asked the user a question with askQuestion, so ` +
              `it can't also wait on them. End your turn; their answer starts the next one.`,
          };
        }
      }
      const wait = { prompt: input.prompt, ...(input.title !== undefined ? { title: input.title } : {}) };
      if (input.kind === "approval") {
        const answer = await ctx.waitForUser({ kind: "approval", ...wait });
        if (answer.cancelled) return { ok: true as const, cancelled: true as const };
        return {
          ok: true as const,
          kind: "approval" as const,
          approved: answer.approved,
          ...(!answer.approved && answer.deadline ? { deadline: true as const } : {}),
          ...(answer.answer !== undefined ? { answer: answer.answer } : {}),
        };
      }
      try {
        const answer = await ctx.waitForUser({ kind: input.kind, ...wait });
        if (answer.cancelled) return { ok: true as const, cancelled: true as const };
        return { ok: true as const, kind: input.kind, answered: true as const, answer: answer.answer };
      } catch (error) {
        if (!(error instanceof SuspensionTimeoutError)) throw error;
        return { ok: true as const, kind: input.kind, answered: false as const, deadline: true as const };
      }
    },
  });

  return {
    /** The tool, for a turn's tool list. */
    tool,
    /** Whether the running turn is offered the tool: a host that can stop a request for the user. */
    offered: async (ctx: BlockContext): Promise<boolean> => ctx.suspend !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Tool factory — closes over the resolver so a capability instance targets a
// specific board.
// ---------------------------------------------------------------------------

/** How {@link buildTaskTools} builds one board's tools. */
interface BuildTaskToolsOptions {
  /** The board's roster, fixed or read per call ({@link AssigneeRosterSource}). */
  readonly roster?: AssigneeRosterSource;
  /** Board qualifier for every tool name ({@link taskToolSuffix}). */
  readonly nameSuffix?: string;
  /**
   * Capabilities each tool composes. Only {@link taskToolActions} passes one: a
   * board's own capability, so the ledger's resource is installed on the
   * action's block rather than left for the flow to declare.
   */
  readonly uses?: readonly DefinedCapability[];
  /**
   * Present no worker claim, whatever async scope the tool runs in. Only
   * {@link taskToolActions} sets it: an action is a caller's move (BR-25), and
   * a worker that dispatches one in-process must not lend it the worker's
   * ticket through the claim seam.
   */
  readonly claimless?: boolean;
  /**
   * Offer the wait: `getTask`'s `wait`, with `deadline` (FIX-2082). Only the
   * capability's per-turn tool list sets it, on a host that can hold a wait
   * ({@link canHoldWait}).
   */
  readonly wait?: boolean;
  /**
   * The board starts a ready row at once ({@link TaskToolsOptions.dispatches}),
   * so `createTask` files each row once per call, since filing starts it.
   */
  readonly dispatches?: boolean;
}

function buildTaskTools(resolve: TaskCollectionResolver, options: BuildTaskToolsOptions = {}) {
  const { roster, nameSuffix, uses, claimless = false, wait = false, dispatches = false } = options;
  const defineTool = uses === undefined ? handler : handler.withDefaults({ uses: [...uses] });
  /**
   * The tool names, optionally board-qualified.
   *
   * A generator asserts its tool names are unique, and these are fixed
   * strings, so composing two boards' capabilities into one block collides on
   * every one of them. A suffix is what makes a second board addressable at
   * all; without one the surface is single-board by construction.
   */
  const named = (base: string): string =>
    nameSuffix === undefined ? base : `${base}_${nameSuffix}`;
  /** How a cancel through this block was made: a model's tool, or a public action (server-set, BP-031). */
  const via = claimless ? ("action" as const) : ("tool" as const);

  // How to wait on a colleague's result (FIX-2082), said once, on createTask: a model told to
  // "ask them and wait" otherwise sends a message.
  const waitHow = wait
    ? " To wait on a colleague's result in this turn, file the task with createTask, then call " +
      "getTask({ id, wait: true }). A message can't be waited on."
    : "";
  const createTaskDescription =
    "File a new task on your delegation board. Returns the new task id. " +
    "assignee names one of your delegates; leave it unset only when you have one delegate. " +
    "The task starts as its start setting says: at once; after deps, task ids on this board " +
    "that must finish first; or, with held: true, once you release it with updateTask " +
    "({ id, status: \"pending\" }). with questions it waits until the user answers each one: plain questions, or " +
    "{ kind: \"confirm\", prompt } for a yes or a no; the answers join its brief. " +
    "input is a structured payload for the worker. " +
    "maxAttempts is how many tries it gets in all. Every field can change with updateTask until " +
    "the task first starts; after that only a cancel. The board may bound how many tasks wait " +
    "at once and how many it may hold in total: enqueued_task_cap_exceeded means too many tasks " +
    "are already waiting to run, and total_task_cap_exceeded is the lifetime ceiling, which " +
    "draining does not reset. Working a task yourself, end your turn once you have filed its " +
    "pieces: each piece's ending wakes you with its result." +
    waitHow;
  const createTaskFields = {
    goal: z.string(),
    title: z
      .string()
      .min(1)
      .optional()
      .describe(
        "A short label for the task, a few words, shown where the task is listed. The goal is the " +
          "full brief; give a title that is not just the goal restated. Omit it and the goal is shown.",
      ),
    context: z.string().optional().describe("What the worker should know beside the goal."),
    assignee: z.string().optional(),
    deps: z.array(z.string()).optional(),
    priority: z.number().optional(),
    // `unknown` has no type, so a model may send this payload as a JSON string.
    input: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Structured payload handed to the worker as the task's input: a JSON object, not a string."),
    labels: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    followUpOf: z
      .string()
      .optional()
      .describe(
        "The id of a task this one follows up. It runs in that task's session, with its " +
          "worker, and its result goes where that task's went, so leave assignee, target and resultTo unset; " +
          "if that session is still working a task, it starts " +
          "once that task ends.",
      ),
    held: z
      .boolean()
      .optional()
      .describe("File the task held: it doesn't start until you release it with updateTask."),
    questions: z
      .array(
        z.union([
          z.string().min(1),
          z.object({
            kind: z.enum(["question", "confirm"]),
            prompt: z.string().min(1),
            onNo: z
              .enum(["cancel", "continue"])
              .optional()
              .describe('A confirm\'s No: "cancel" (the default) cancels the task; "continue" lets it go on with the No in its brief.'),
          }),
        ]),
      )
      .optional()
      .describe(
        "Questions for the user, asked before the task starts: it waits until every one is answered, and each answer " +
          'joins its brief. A plain string is a question; { kind: "confirm", prompt } asks for a yes or a no, and a No ' +
          'cancels the task unless you pass onNo: "continue". Set only when filing.',
      ),
    session: z
      .enum(["new", "ongoing"])
      .optional()
      .describe("Where it runs: a session of its own (new, the default), or the delegate's ongoing session."),
    resultTo: z
      .enum(["filer", "conversation"])
      .optional()
      .describe("Who hears its result: you (filer, the default), or the conversation, under the delegate's name."),
    target: z
      .string()
      .min(1)
      .optional()
      .describe(
        "For an assignee that leads a workstream here: the workstream, by the target its delegate record names. " +
          "The task runs in that workstream's session. Set only when filing.",
      ),
    maxAttempts: z.number().int().positive().optional().describe("How many tries the task gets in all."),
    // Every field `updateTask` edits is one a filing sets, plus the filing-only keys above.
  } satisfies Record<TaskUpdateField, z.ZodTypeAny> & Record<string, z.ZodTypeAny>;
  type NewTaskInput = z.infer<z.ZodObject<typeof createTaskFields>>;
  /**
   * The fields that would make a filing wait, refused by name: `createTask`
   * only files, and the wait is `getTask`'s (FIX-2082; FIX-1875 BR-21). Read
   * from the call's input before anything else: the schema doesn't name them,
   * so a plain parse would drop them and file a task the caller thinks it
   * waits on.
   */
  const WAIT_FIELDS = ["wait", "deadline", "waitForResponse", "timeoutMs"] as const; // retired-name-refusal: waitForResponse
  type FollowUp = { root: string; assignee: string | undefined; id: string };

  /**
   * A decision read from the roster, which can change between a call and its
   * replay: recorded with the call when `memoize`, so the replay of a call
   * that already filed or readied its row decides as the first call did, and
   * reaches its own write instead of a refusal (FIX-1875 BR-15). `null`
   * stands for "nothing to refuse" in the record, which holds JSON only.
   */
  /**
   * The id this call recorded for the row it files, as `fileReady` records
   * it: read back on a replay, minted and recorded now otherwise. `undefined`
   * where the turn carries no tool call or no `runOnce`.
   */
  async function recordedFiling(ctx: BlockContext): Promise<string | undefined> {
    const call = toolCallOf(ctx);
    if (call === undefined || ctx.runOnce === undefined) return undefined;
    return ctx.runOnce(`fsd.dispatch.plan:${call.logicalId}`, async () => mintTaskId());
  }

  /**
   * The refusal for filing work a task still open already holds: the same
   * goal, ignoring case and spacing, for the same worker. Names the open task
   * by its title, so a reply can name it the same way.
   */
  function openSameWork(collection: TaskCollectionRef, assignee: string, goal: string): { taskId: string; error: string } | undefined {
    const same = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
    const open = collection
      .list()
      .find((row) => row.assignee === assignee && !isTerminalStatus(row.status) && same(row.goal) === same(goal));
    if (open === undefined) return undefined;
    return {
      taskId: open.id,
      error:
        `already_open: task "${open.title ?? open.goal}" (${open.id}) is this same work for ${assignee}, and it is still ` +
        `${open.status}. Nothing was filed. Say that task is on it. To change it, send it a message with updateTask; ` +
        `to replace it, cancel it first.`,
    };
  }

  async function decideOnce<T>(
    ctx: BlockContext,
    memoize: boolean,
    name: string,
    decide: () => Promise<T>,
  ): Promise<T> {
    const call = memoize ? toolCallOf(ctx) : undefined;
    return call !== undefined && ctx.runOnce !== undefined
      ? ctx.runOnce(`fsd.decide.${name}:${call.logicalId}`, decide)
      : decide();
  }

  /**
   * A new task's checks, in their order, run by `createTask` (FIX-1875
   * BR-14): the follow-up (in this board's partition only), then the assignee against the
   * roster. The creation cap comes last, at the write ({@link fileNewTask}).
   * Every refusal comes before anything is filed.
   *
   * `memoize` records the follow-up's checks, and the id they pick, with the
   * call, so a replay of a waiting or dispatching call reuses them instead of
   * re-counting against a board that now holds this follow-up.
   */
  async function checkNewTask(
    ctx: BlockContext,
    collection: TaskCollectionRef,
    input: NewTaskInput,
    memoize: boolean,
  ): Promise<{ init: TaskInit; followUp: FollowUp | undefined } | { ok: false; error: string }> {
    let followUp: FollowUp | undefined;
    if (input.followUpOf !== undefined) {
      const followUpOf = input.followUpOf;
      const check = async () => resolveFollowUp(collection, followUpOf);
      const call = memoize ? toolCallOf(ctx) : undefined;
      const resolved =
        call !== undefined && ctx.runOnce !== undefined
          ? await ctx.runOnce(`fsd.followUp:${call.logicalId}`, check)
          : await check();
      if ("error" in resolved) return resolved;
      followUp = resolved;
    }
    const assignee = followUp !== undefined ? followUp.assignee : input.assignee;
    // Failure order is deliberate and uniform across the tools that touch an
    // assignee: no board (the caller's) -> unknown assignee -> creation cap.
    //
    // The cap comes LAST because "that worker doesn't exist" is the more
    // useful thing to tell a model, and because a task refused for a phantom
    // assignee must not consume budget or reach the ledger at all — otherwise
    // a typo'd add could be what trips the cap for a later valid one. It also
    // avoids a two-round-trip dead end at the boundary: cap-first would answer
    // "board full" to a caller whose real problem is the assignee, which it
    // would then still hit after fixing it. `checkAssignee` is a pure
    // pre-flight, so running it first costs nothing.
    const bad =
      assignee === undefined
        ? undefined
        : await decideOnce(ctx, memoize, "assignee", async () => checkAssignee(assignee, await rosterFor(roster, ctx)) ?? null);
    if (bad) return bad;
    // One piece of work, one task (FIX-2350): the same goal for the same
    // worker while a task for it is open is a second start, from a call sent
    // twice or retried. Decided once per call, so a replay finds its own row.
    // A message handed on (`resultTo: "conversation"`) keeps its own rule:
    // one task per delegate a round, recorded by the routing that files it.
    const open =
      followUp === undefined && assignee !== undefined && input.resultTo !== "conversation"
        ? await decideOnce(ctx, memoize, "same-work", async () => {
            const refusal = openSameWork(collection, assignee, input.goal);
            // A call an older build filed has its id recorded and no decision:
            // the open row is its own, found again by `fileReady`.
            return refusal === undefined || (memoize && refusal.taskId === (await recordedFiling(ctx))) ? null : refusal.error;
          })
        : null;
    if (open) return { ok: false as const, error: open };
    // The task whose request files this one: the task the worker's request
    // works, claimed or not (a cancelled task's run that goes on has no
    // claim, and is still its filer, so its filing is refused). Server-set,
    // never input (BP-031). An action works none.
    const filedByTask = claimless ? undefined : currentWorkerTask(ctx)?.taskId;
    return {
      init: {
        goal: input.goal,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
        ...(assignee !== undefined ? { assignee } : {}),
        ...(followUp !== undefined ? { id: followUp.id, followUpOf: followUp.root } : {}),
        ...(input.deps !== undefined ? { deps: input.deps } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
        // A caller's metadata never carries a notice marker, nor the call that filed a row (BP-031).
        ...(input.metadata !== undefined ? { metadata: taskToolCallerMetadata(input.metadata) } : {}),
        ...(input.held === true ? { held: true } : {}),
        // An empty list is no questions: smaller models send one when told to leave the field out (FIX-2277).
        ...(input.questions !== undefined && input.questions.length > 0 ? { questions: input.questions.map(askOf) } : {}),
        ...(input.session !== undefined ? { session: input.session } : {}),
        ...(input.resultTo !== undefined ? { resultTo: input.resultTo } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(filedByTask !== undefined ? { filedByTask } : {}),
      },
      followUp,
    };
  }

  /**
   * Run a new task's write, turning the refusals the write itself can make
   * into the soft errors `createTask` answers: a creation cap (FIX-931),
   * and a follow-up's id taken by one filed at the same moment. Every other
   * throw propagates.
   */
  async function fileNewTask<T>(
    followUp: FollowUp | undefined,
    write: () => Promise<T>,
  ): Promise<T | { ok: false; error: string }> {
    try {
      return await write();
    } catch (err) {
      // A creation cap (FIX-931) is a soft error the model can act on — drain
      // to free enqueue slots, or stop planning at the lifetime ceiling.
      if (err instanceof TaskCapExceededError) return capError(err);
      // A wrapping ref's own rule refused the filing (FIX-2076).
      if (err instanceof TaskWriteRefusedError) return refusedError(err);
      // A filing the board can't run as asked (FIX-2080): a dependency on
      // another board, one already ended, a loop, or a setting this board
      // can't honour. The message names the rule.
      if (err instanceof TaskFilingRefusedError) return { ok: false as const, error: err.message };
      // A follow-up's id was taken by one filed at the same moment.
      if (followUp !== undefined && isTakenTaskId(err)) return followUpTakenError(followUp.id);
      throw err;
    }
  }

  const createTask = defineTool({
    name: named("createTask"),
    description: createTaskDescription,
    // Passthrough, so a retired wait field reaches `execute` to be refused by
    // name rather than stripped by the parse (BR-21).
    inputSchema: z.object(createTaskFields).passthrough(),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), taskId: z.string(), status: z.literal("held").optional() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (raw, ctx) => {
      const input = raw as NewTaskInput & Record<string, unknown>;
      const waitFields = WAIT_FIELDS.filter((field) => input[field] !== undefined);
      if (waitFields.length > 0) {
        return {
          ok: false as const,
          error:
            `create_task_does_not_wait: createTask takes no ${waitFields.join(" or ")}; it only files a task. ` +
            (wait
              ? "To wait for its result, file it, then call getTask({ id, wait: true }) with the id it returns. "
              : "You can't wait on a task here: you hear when it ends. ") +
            "Nothing was filed.",
        };
      }
      // A follow-up takes the task's worker: another worker is another
      // session. Refused at input, before the board is read.
      if (input.followUpOf !== undefined && input.assignee !== undefined) {
        return followUpAssigneeError(input.followUpOf);
      }
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      // One filing at a time per board where the same-work check runs: a
      // step's sibling calls run at once, and the check must see the row the
      // other call filed. A follow-up keeps its own race rule (BR-25).
      const file = async () => {
        // Recorded with the call on a board that starts work, so a replay decides as the first call did.
        const checked = await checkNewTask(ctx, collection, input, dispatches);
        if ("error" in checked) return checked;
        return fileNewTask(checked.followUp, async () => {
          // On a board that starts a ready row at once, a filing starts work:
          // once per call, so a replay finds its own row (BR-15).
          const filed = dispatches
            ? await fileReady(ctx, collection, checked.init)
            : { ok: true as const, taskId: (await collection.createTask(checked.init)).id };
          return input.held === true ? { ...filed, status: "held" as const } : filed;
        });
      };
      return input.followUpOf === undefined ? oneFilingAtATime(`${collection.collectionId}\u0000${collection.partition ?? ""}`, file) : file();
    },
  });

  /**
   * File a new row ready, once per call: its id is recorded with the call, so
   * a replay after a crash finds its own row instead of filing a second
   * (BR-15). Where the turn carries no tool call or no `runOnce`, it is the
   * unguarded path: a plain `createTask`, with no replay protection.
   */
  async function fileReady(ctx: BlockContext, collection: TaskCollectionRef, init: TaskInit) {
    const call = toolCallOf(ctx);
    if (call === undefined || ctx.runOnce === undefined) {
      const task = await collection.createTask(init);
      return { ok: true as const, taskId: task.id };
    }
    // Whether this run recorded the call's id, or a replay read it back.
    let recordedNow = false;
    const id = await ctx.runOnce(`fsd.dispatch.plan:${call.logicalId}`, async () => {
      recordedNow = true;
      return init.id ?? mintTaskId();
    });
    // An id minted here is this call's alone, so a row with it is its own. A
    // follow-up's id is picked from the board, so another call can have
    // filed it: such a row names the call that filed it, and is this call's
    // only when it names this one; otherwise the add refuses the id as taken.
    // A row filed before rows named their call (BP-030) is this call's on a
    // replay, as it was then. That holds while every filer of a picked id on
    // a dispatching board goes through this function.
    const picked = init.id !== undefined;
    const existing = collection.get(id);
    const filedBy = existing?.metadata?.[FILED_BY_CALL_KEY];
    if (existing !== undefined && (!picked || filedBy === call.logicalId || (filedBy === undefined && !recordedNow))) {
      return { ok: true as const, taskId: id };
    }
    const task = await collection.createTask(
      picked ? { ...init, id, metadata: { ...(init.metadata ?? {}), [FILED_BY_CALL_KEY]: call.logicalId } } : { ...init, id }
    );
    return { ok: true as const, taskId: task.id };
  }

  /** The fields `updateTask` edits, each by its rule in the field table (`TASK_FIELD_RULES`). */
  const updateFields = {
    goal: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    context: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional().describe("The task's structured input, replaced whole."),
    deps: z.array(z.string()).optional().describe("Task ids on this board that must finish first, replaced whole."),
    priority: z.number().optional(),
    labels: z.array(z.string()).optional().describe("The task's labels, replaced whole: send the full list."),
    metadata: z.record(z.string(), z.unknown()).optional().describe("Keys merged over the task's metadata."),
    assignee: z.string().optional().describe("One of your delegates."),
    maxAttempts: z.number().int().positive().optional(),
    // Exactly the table's fields: one added on either side alone fails to compile.
  } as const satisfies Record<TaskUpdateField, z.ZodTypeAny>;
  type UpdateField = keyof typeof updateFields;
  const UPDATE_FIELDS = Object.keys(updateFields) as UpdateField[];
  /** The filing settings: chosen when a task is filed, and refused by name on an update. */
  const FILING_SETTINGS = ["session", "resultTo", "target"] as const;

  /** The fields a refusal names: the table's words, a status read as a hold or a release. */
  const fieldNames = (fields: readonly TaskEditField[]): string =>
    fields.map((field) => (field === "held" ? "a hold or a release" : field)).join(", ");

  /** The refusal for a message on a finished task: the rule, then the move (FIX-2086). */
  const FINISHED_TAKES_NO_MESSAGE = "a finished task takes no message; file a follow-up";

  /**
   * The refusal for an edit the field table no longer allows: every field on
   * a finished task, an until-start field on a started one. Names the
   * fields, the state, and the next move.
   */
  const lockedError = (task: Task, fields: readonly TaskEditField[]) => {
    if (isTerminalStatus(task.status)) {
      const rule = fields.includes("message")
        ? `${FINISHED_TAKES_NO_MESSAGE} with createTask({ followUpOf: "${task.id}" }) to correct or extend it. ` +
          `Task "${task.id}" is ${task.status}, so nothing about it changes, its output included (${fieldNames(fields)}).`
        : `task "${task.id}" is ${task.status}, so nothing about it changes, its output included (${fieldNames(fields)}). ` +
          `File a follow-up with createTask({ followUpOf: "${task.id}" }) for more work.`;
      return { ok: false as const, taskId: task.id, error: `task_finished: ${rule} Nothing was written.` };
    }
    const reassign = fields.includes("assignee")
      ? ` A started task keeps one accountable worker: to move it, cancel it and file it again.`
      : "";
    return {
      ok: false as const,
      taskId: task.id,
      error:
        `field_locked_after_start: ${fieldNames(fields)} can't change once a task starts, and task ` +
        `"${task.id}" has started (it is ${task.status}).${reassign} Until it finishes you can cancel it ` +
        `(status: "cancelled"), or file a follow-up once it ends. Nothing was written.`,
    };
  };

  const updateTask = defineTool({
    name: named("updateTask"),
    description:
      "Change a task you filed. Every field changes only before the task first starts: goal, " +
      "title, context, input, deps, priority, labels (the full list), metadata, assignee (one of " +
      "your delegates) and maxAttempts; and status: \"held\" holds it, \"pending\" releases a held " +
      "task. status: \"cancelled\" cancels it, any time until it finishes, and is sent alone. " +
      "message steers the task until it finishes, and is sent alone: the words join its brief, " +
      "and a running task's worker reads them before its next model call. It uses none of the " +
      "task's tries and never cancels it. A finished task changes no more, and takes no message: file a " +
      "follow-up instead. answers names one of the task's open questions, by its id, with message: only one " +
      "its worker asked you midway; the user answers the rest. A refusal names the rule.",
    // Passthrough, so a filing setting reaches `execute` to be refused by name
    // rather than stripped by the parse.
    inputSchema: z
      .object({
        id: z.string(),
        ...updateFields,
        status: z.enum(["held", "pending", "cancelled"]).optional(),
        message: z
          .string()
          .min(1)
          .optional()
          .describe("Words for the task while it is open, sent alone: they join its brief. Uses no try, never cancels."),
        answers: z
          .string()
          .min(1)
          .optional()
          .describe("The id of the open question message answers (getTask lists them under questions). Sent with message only."),
        ...(claimless
          ? {
              done: z
                .boolean()
                .optional()
                .describe("A confirm's answer, with answers: true gives the go, false says no. message is an optional note."),
            }
          : {}),
      })
      .passthrough(),
    outputSchema: z.union([
      // A cancel names the dependents it took along (FIX-2078 D2).
      z.object({ ok: z.literal(true), cancelled: z.array(z.string()).optional() }),
      z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
    ]),
    execute: async (input, ctx) => {
      const settings = FILING_SETTINGS.filter((field) => (input as Record<string, unknown>)[field] !== undefined);
      if (settings.length > 0) {
        return {
          ok: false as const,
          taskId: input.id,
          error:
            `filing_setting_fixed: ${settings.join(", ")} ${settings.length === 1 ? "is" : "are"} chosen when a task ` +
            `is filed and never ${settings.length === 1 ? "changes" : "change"}. To change ${settings.length === 1 ? "it" : "them"}, ` +
            `cancel the task and file it again. Nothing was written.`,
        };
      }
      const fields = UPDATE_FIELDS.filter((field) => input[field] !== undefined);
      const message = input.message;
      // `question` was the answer's field before FIX-2183: refused by name, so a call
      // that still sends it is never kept as a plain message.
      if ((input as Record<string, unknown>).question !== undefined) {
        return {
          ok: false as const,
          taskId: input.id,
          error: "answers_not_question: name the question you answer with answers, not question. Nothing was written.", // retired-name-refusal: question
        };
      }
      // An answer (FIX-2133) is its own write, decided apart from every edit.
      const answers = input.answers;
      const done = (input as { done?: unknown }).done;
      if (answers !== undefined || done !== undefined) {
        return answerQuestion(ctx, { id: input.id, answers, message, done, fields, status: input.status });
      }
      if (input.status === "cancelled" && (fields.length > 0 || message !== undefined)) {
        const sent = [...fields, ...(message !== undefined ? ["message"] : [])];
        return {
          ok: false as const,
          taskId: input.id,
          error:
            `cancel_takes_no_edits: a cancel is sent alone, and this one came with ${sent.join(", ")}. ` +
            `Cancel it, or edit it, not both. Nothing was written.`,
        };
      }
      // A message is its own write: sent with an edit or a hold, one could land
      // and the other be refused, so the pair is refused before either is written.
      if (message !== undefined && input.status !== "cancelled" && (fields.length > 0 || input.status !== undefined)) {
        const sent = [...fields, ...(input.status !== undefined ? ["status"] : [])];
        return {
          ok: false as const,
          taskId: input.id,
          error:
            `message_takes_no_edits: a message is sent alone, and this one came with ${sent.join(", ")}. ` +
            `Send the edit and the message as two calls. Nothing was written.`,
        };
      }
      if (input.status === undefined && fields.length === 0 && message === undefined) {
        return {
          ok: false as const,
          taskId: input.id,
          error:
            `nothing_to_update: name a field to change beside id, flat, such as updateTask({ id, priority: 2 }), ` +
            `or a status. Nothing was written.`,
        };
      }
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const current = collection.get(input.id);
      if (!current) return taskNotFoundError(input.id);

      if (input.status === "cancelled") {
        try {
          // A model's own cancel in its own turn: the call's result tells its filer, so it owes no notice (FIX-2078 D2).
          // A task waiting on a user is cancelled under its stop's fence, and its run resumes `cancelled` (FIX-2129).
          const outcome: TaskWriteOutcome | undefined = await cancelAndResume(ctx as never, collection, input.id, undefined, {
            via,
            ...(via === "tool" ? { viaTool: true } : {}),
          });
          if (outcome != null && outcome.outcome === "declined") {
            const now = collection.get(input.id) ?? { ...current, status: outcome.status };
            return isTerminalStatus(outcome.status)
              ? lockedError(now, ["cancel"])
              : declinedWriteToolError(input.id, outcome, STATUS_CLAUSE);
          }
        } catch (err) {
          if (err instanceof TaskWriteRefusedError) return refusedError(err);
          throw err;
        }
        // The dependents the cancel took along, which owe no notice of their own
        // when the filer cancelled through its own tool (FIX-2078 D2): named here.
        const cancelledRow = collection.get(input.id);
        // By the board's own filer rule, the one the cascade suppressed their
        // notices by, so a row filed before the upgrade is read right (BP-030).
        const filerOf = collection.filerOf?.bind(collection);
        const cancelled = cancelledRow === undefined ? [] : cancelledDependents(cancelledRow, collection.list(), filerOf);
        return cancelled.length > 0 ? { ok: true as const, cancelled } : { ok: true as const };
      }

      const edits: TaskEditField[] = [
        ...fields,
        ...(input.status !== undefined ? (["held"] as const) : []),
        ...(message !== undefined ? (["message"] as const) : []),
      ];
      // Refused before anything is checked when the state already rules it
      // out; decided again inside the write, so a start in between is refused too.
      // Two rules hold in every state and name their own refusal, so they go
      // to the write: a step's hold (`step_cannot_be_held`) and a
      // conversation-result task's attempts (`conversation_result_one_attempt`).
      const ownRule =
        input.status !== undefined || (input.maxAttempts !== undefined && current.resultTo === "conversation");
      // A hold or release is decided by the write, which also knows the one
      // release a started held row may take (a legacy blocked row, BP-030).
      const locked = ownRule ? [] : lockedFields(current, edits);
      if (locked.length > 0) return lockedError(current, locked);
      // A message's own checks run before any write too (FIX-2086), so a call
      // that edits and steers never half-applies: a finished task (the hold
      // or release, decided by the write, aside) and the steer limit.
      if (message !== undefined) {
        if (isTerminalStatus(current.status)) return lockedError(current, ["message"]);
        // Each open question keeps its answer's place under the cap (FIX-2133).
        if (steerPlacesTaken(current) >= MAX_STEERS) return steerLimitError(input.id);
        if (collection.steer === undefined) {
          return {
            ok: false as const,
            taskId: input.id,
            error: `message_not_supported: task "${input.id}"'s board takes no message. Nothing was written.`,
          };
        }
      }
      if (input.assignee !== undefined && input.assignee !== current.assignee) {
        const bad = checkAssignee(input.assignee, await rosterFor(roster, ctx));
        if (bad) return bad;
      }
      if (fields.length > 0 || input.status !== undefined) {
        const patch: TaskSettingsPatch = {
          ...(input.status === "held" ? { held: true } : {}),
          ...(input.status === "pending" ? { held: false } : {}),
          ...Object.fromEntries(fields.map((field) => [field, input[field]])),
          // Nor can a patch forge, clear or settle a notice marker, or the call that filed the row (BP-031, FIX-2078).
          ...(input.metadata !== undefined ? { metadata: taskToolCallerMetadata(input.metadata) } : {}),
        };
        let outcome: TaskWriteOutcome | undefined;
        try {
          outcome = await collection.patchSettings(input.id, patch);
        } catch (err) {
          if (err instanceof TaskFilingRefusedError) return { ok: false as const, taskId: input.id, error: err.message };
          if (err instanceof TaskWriteRefusedError) return refusedError(err);
          throw err;
        }
        if (outcome != null && outcome.outcome === "declined") {
          const now = collection.get(input.id) ?? { ...current, status: outcome.status };
          if (outcome.reason === "started" || outcome.reason === "terminal") {
            const lockedNow = lockedFields(now, edits);
            return lockedError(now, lockedNow.length > 0 ? lockedNow : edits);
          }
          return declinedWriteToolError(input.id, outcome, "Nothing was written.");
        }
      }
      if (message !== undefined) {
        // The filer's model through its own tool, or a person through the
        // action (a screen): the sender is how the caller was built, never input.
        const userId = (ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId;
        const from = via === "tool" ? { from: "filer" as const } : { from: "user" as const, ...(userId !== undefined ? { by: userId } : {}) };
        let steered: TaskWriteOutcome | undefined;
        try {
          steered = await collection.steer!(input.id, { message, ...from });
        } catch (err) {
          if (err instanceof TaskWriteRefusedError) return refusedError(err);
          throw err;
        }
        if (steered != null && steered.outcome === "declined") {
          if (steered.reason === "steer-limit") return steerLimitError(input.id);
          const now = collection.get(input.id) ?? { ...current, status: steered.status };
          if (steered.reason === "terminal") return lockedError(now, ["message"]);
          return declinedWriteToolError(input.id, steered, "The message was not kept.");
        }
      }
      return { ok: true as const };
    },
  });

  /**
   * Answer one of a task's open questions or confirms (FIX-2133 D1): the
   * user's words, kept as a steer carrying the question's id, which join the
   * brief; the last answer lets the work go on, in the same write.
   *
   * Before it reads a status or a question it checks the caller reaches the
   * row: the user, tenant and org the filing ran under, compared as the
   * engine compares a request's (BP-031). A row it doesn't reach is answered as
   * not found, with nothing written. Through the public action (a screen) it
   * answers any open question or confirm, as the user; through the filer's own
   * tool, only a question the task's worker asked it midway, on a task not
   * routed to a workstream (ER-4). The sender is how the caller was built and
   * who the request was verified as, never input.
   */
  async function answerQuestion(
    ctx: BlockContext,
    input: { id: string; answers: string | undefined; message: string | undefined; done: unknown; fields: readonly string[]; status: string | undefined }
  ) {
    const refuse = (error: string) => ({ ok: false as const, taskId: input.id, error: `${error} Nothing was written.` });
    if (input.answers === undefined) {
      return refuse("done_without_answers: done answers a confirm, and names it with answers. Send both.");
    }
    if (input.fields.length > 0 || input.status !== undefined) {
      const sent = [...input.fields, ...(input.status !== undefined ? ["status"] : [])];
      return refuse(`answer_takes_no_edits: an answer is sent alone, with message, and this one came with ${sent.join(", ")}. Send them as two calls.`);
    }
    const collection = await resolve(ctx);
    if (!collection) return noBoardError;
    await collection.refresh?.(input.id);
    const row = collection.get(input.id);
    if (row === undefined || !callerReaches(ctx, row)) return taskNotFoundError(input.id);
    const hold = row.questions?.find((h) => h.id === input.answers);
    if (hold === undefined || !isRowQuestion(hold)) {
      return refuse(`no_such_question: task "${input.id}" holds no question "${input.answers}". Read its open questions with getTask.`);
    }
    if (!claimless && (hold.midway !== true || row.target !== undefined || row.targetSessionId !== undefined)) {
      return refuse(
        `question_is_the_users: "${input.answers}" is the user's to answer` +
          (hold.midway === true ? ", since the task runs in a workstream" : ", since it was asked when the task was filed") +
          ". They answer it from their Inbox. Send what you know as a message instead.",
      );
    }
    let text: string;
    if (hold.ask.kind === "confirm") {
      if (typeof input.done !== "boolean") {
        return refuse(`confirm_takes_done: "${input.answers}" asks for a yes or a no. Answer it with done: true or false, and a note in message if you like.`);
      }
      text = `${input.done ? "Yes, go ahead." : "No."}${input.message !== undefined ? ` ${input.message}` : ""}`;
      // A No on a confirm that cancels (the default, owner 2026-10-25): the
      // task is cancelled through the one cancel path, the No and its note
      // its reason. Before any answer is kept, so the release never starts it.
      if (input.done === false && hold.ask.onNo !== "continue") return cancelOnNo(ctx, collection, row, hold, input.message);
    } else {
      if (input.done !== undefined) return refuse(`question_takes_message: "${input.answers}" is a question. Answer it with message.`);
      if (input.message === undefined) return refuse(`question_takes_message: an answer to "${input.answers}" needs its words in message.`);
      text = input.message;
    }
    if (collection.answer === undefined) return refuse(`questions_not_supported: task "${input.id}"'s board keeps no questions.`);
    const userId = (ctx as { user?: { identity?: { userId?: string } } }).user?.identity?.userId;
    const answer: QuestionAnswer =
      via === "tool"
        ? { questionId: hold.id, message: text, from: "filer" }
        : { questionId: hold.id, message: text, from: "user", ...(userId !== undefined ? { by: userId } : {}) };
    let outcome: TaskWriteOutcome | undefined;
    try {
      outcome = await collection.answer(input.id, answer);
    } catch (err) {
      if (err instanceof TaskWriteRefusedError) return refusedError(err);
      throw err;
    }
    if (outcome != null && outcome.outcome === "declined") {
      if (outcome.reason === "answered") return refuse(`question_answered: "${input.answers}" on task "${input.id}" was already answered.`);
      if (outcome.reason === "terminal") return lockedError(collection.get(input.id) ?? { ...row, status: outcome.status }, ["message"]);
      if (outcome.reason === "no-such-question") return refuse(`no_such_question: task "${input.id}" holds no question "${input.answers}".`);
      return declinedWriteToolError(input.id, outcome, "The answer was not kept.");
    }
    return { ok: true as const };
  }

  /**
   * A confirm answered No, on a confirm whose No cancels: the task's ordinary
   * cancel (`cancelAndResume`, the cancel `updateTask` sends), as the user,
   * with the No and its note as the reason. Retried after it landed, the same
   * No is a success; a task that finished another way is refused as finished.
   */
  async function cancelOnNo(ctx: BlockContext, collection: TaskCollectionRef, row: Task, hold: RowQuestion, note: string | undefined) {
    const reason = `No to "${hold.ask.prompt}"${note !== undefined && note.trim().length > 0 ? `: ${note}` : ""}`;
    if (isTerminalStatus(row.status)) {
      return row.status === "cancelled" && row.error === reason ? { ok: true as const } : lockedError(row, ["message"]);
    }
    let outcome: TaskWriteOutcome | undefined;
    try {
      // Fenced on the confirm still open, in the cancel's own write: a No after a yes, or racing one, can't cancel.
      outcome = await cancelAndResume(ctx as never, collection, row.id, reason, { via, whileQuestionOpen: hold.id });
    } catch (err) {
      if (err instanceof TaskWriteRefusedError) return refusedError(err);
      throw err;
    }
    if (outcome != null && outcome.outcome === "declined") {
      const now = collection.get(row.id) ?? { ...row, status: outcome.status };
      if (now.status === "cancelled" && now.error === reason) return { ok: true as const };
      if (outcome.reason === "answered") return { ok: false as const, taskId: row.id, error: `question_answered: "${hold.id}" on task "${row.id}" was already answered. Nothing was written.` };
      return isTerminalStatus(outcome.status) ? lockedError(now, ["message"]) : declinedWriteToolError(row.id, outcome, "The No was not kept.");
    }
    return { ok: true as const };
  }

  /** The refusal past the most messages a task takes (FIX-2086 D1): names the limit and the move. */
  function steerLimitError(id: string) {
    return {
      ok: false as const,
      taskId: id,
      error:
        `steer_limit: task "${id}" has taken ${MAX_STEERS} messages, the most a task takes. Cancel it and ` +
        `file it again with everything it needs, or file a follow-up once it ends. Nothing was written.`,
    };
  }

  /**
   * What a running task waits on while no worker holds it (FIX-2077's
   * `keptOpenBy`), and what holds it for a person (FIX-2133): its open holds,
   * a question or a confirm on the row, or a task run's stop, each with what
   * it asks and when it falls due. One shape for every stop.
   */
  const waitingShape = {
    keptOpenBy: z.enum(["wait", "filed", "steer"]).optional(),
    /** What the task waits on now, oldest first; absent when nothing does. Answer a question with `updateTask({ id, answers, message })`. */
    questions: z.array(taskQuestionSchema).optional(),
  };

  const listTasks = defineTool({
    name: named("listTasks"),
    description:
      "List tasks on your delegation board, optionally filtered by status, assignee, or the task " +
      "whose request filed them (filedByTask). Rows carry each task's status note, never its output: " +
      "read one task's output with getTask. Don't list to wait for a task you filed to end: end " +
      "your turn, and its ending wakes you.",
    inputSchema: z.object({
      status: z
        .enum(["pending", "in_progress", "held", "completed", "errored", "cancelled"])
        .optional(),
      assignee: z.string().optional(),
      filedByTask: z.string().optional().describe("Only the tasks this task's request filed: its pieces."),
    }),
    outputSchema: z.union([
      z.object({
        ok: z.literal(true),
        tasks: z.array(
          z.object({
            id: z.string(),
            goal: z.string(),
            /** The short label the task was filed under, when it has one. */
            title: z.string().optional(),
            status: z.string(),
            assignee: z.string().optional(),
            attempts: z.number(),
            /** Its worker's last one-line progress note, when it reported one. */
            statusNote: z.string().optional(),
            /** The task whose request filed it, when a task did. */
            filedByTask: z.string().optional(),
            // The run working the task, or the one that last worked it: a
            // reader opens it from here (FIX-1668). Absent until a run starts.
            run: taskSchema.shape.run,
            /**
             * What the task's runs spent (FIX-2288): the harness and model
             * running it and its tokens, `null` when it never ran in a request
             * of its own. On the board's action only: a model's tool reads none.
             */
            spend: taskSpendViewSchema.nullable().optional(),
            /** A request is waiting on this task's ending (`getTask` with `wait`). */
            waitedOn: z.literal(true).optional(),
            ...waitingShape,
            /** The latest completed follow-up in its chain, by id; read its output with getTask (FIX-2086). */
            current: z.object({ id: z.string() }).optional(),
          }),
        ),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (input, ctx) => {
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const filter = {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.filedByTask !== undefined ? { filedByTask: input.filedByTask } : {}),
      };
      const tasks = collection.list(Object.keys(filter).length > 0 ? filter : undefined);
      // Every chain's current in one pass over the board, never a walk per row.
      const latest = latestCompletedByRoot(collection.list());
      return {
        ok: true as const,
        tasks: tasks.map((t) => ({
          id: t.id,
          goal: t.goal,
          ...(t.title !== undefined ? { title: t.title } : {}),
          status: t.status,
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
          attempts: t.attempts,
          ...(t.statusNote !== undefined ? { statusNote: t.statusNote } : {}),
          ...(t.filedByTask !== undefined ? { filedByTask: t.filedByTask } : {}),
          ...(t.run != null ? { run: t.run } : {}),
          // A client's read, never a model's (FIX-2288): the action carries it, the tool doesn't.
          ...(claimless ? { spend: taskSpendView(t) } : {}),
          ...(t.wait != null && t.wait.lapsed !== true && !isTerminalStatus(t.status) ? { waitedOn: true as const } : {}),
          ...waitingOf(t),
          ...withCurrentId(currentFor(t, latest.get(t.followUpOf ?? t.id))),
        })),
      };
    },
  });

  const getTaskWaitDescription =
    " To use a task's result in this turn, set wait: true: you wait until the task ends, or " +
    "until deadline (ms from now, five minutes when unset) passes, and get the task back as " +
    "it stands then; its status says which. The deadline cancels nothing: the task runs on, " +
    "and you can wait on it again. Wait only on a task you filed whose result comes to you, " +
    "one wait per step. A refusal names the rule.";
  const getTask = defineTool({
    name: named("getTask"),
    description:
      "Read one task on your delegation board in full: what it was asked to do (goal, " +
      "context and input), every field you can edit before it starts, how it stands, its " +
      "worker's latest status note, and its output: the result so far while it runs, or its " +
      "result once it completed. checkpoint: true means the output came from a reported " +
      "checkpoint. Its error when it failed. questions are what it waits on now: a question " +
      "(answer it with updateTask, naming it), or a stop for the user. current is the latest follow-up in its chain that completed, with its output: " +
      "the version that stands now; output stays the task's own. steers are the messages sent " +
      "into it, oldest first, each marked taken once its work read it. When this read is how you " +
      "hear the task failed or was cancelled, cancelled lists the tasks you filed that depended " +
      "on it, which that ending cancelled. Use it to answer from what " +
      "a task found, rather than from a line about it. " +
      "Don't poll a task you filed to see it end: end your turn, and its ending wakes you." +
      (wait ? getTaskWaitDescription : ""),
    // Passthrough, so a wait field this request can't use reaches `execute`
    // to be refused by name rather than stripped by the parse.
    inputSchema: z
      .object({
        id: z.string(),
        ...(wait
          ? {
              wait: z.boolean().optional().describe("Wait until the task ends, or until the deadline, before reading it."),
              deadline: z
                .number()
                .optional()
                .describe("How long to wait, in ms from now. Five minutes when unset. Only with wait."),
            }
          : {}),
      })
      .passthrough(),
    outputSchema: z.union([
      z.object({
        ok: z.literal(true),
        task: z.object({
          id: z.string(),
          goal: z.string(),
          title: z.string().optional(),
          status: z.string(),
          assignee: z.string().optional(),
          context: z.string().optional(),
          deps: z.array(z.string()).optional(),
          priority: z.number().optional(),
          labels: z.array(z.string()).optional(),
          /** Its metadata; a string, cut, when it was too long to return. */
          metadata: z.unknown().optional(),
          /** True when `metadata` was cut to {@link READ_OUTPUT_LIMIT} characters. */
          metadataCut: z.literal(true).optional(),
          attempts: z.number(),
          maxAttempts: z.number().optional(),
          /** Its filing settings, when it was filed with any (FIX-2080, FIX-2083). */
          session: z.enum(["new", "ongoing"]).optional(),
          resultTo: z.enum(["filer", "conversation"]).optional(),
          target: z.string().optional(),
          input: z.unknown().optional(),
          /** True when `input` was cut to {@link READ_OUTPUT_LIMIT} characters. */
          inputCut: z.literal(true).optional(),
          /** The task's output: its result, or its worker's latest checkpoint; a string, cut, when too long to return. */
          output: z.unknown().optional(),
          /** True when `output` was cut to {@link READ_OUTPUT_LIMIT} characters. */
          outputCut: z.literal(true).optional(),
          /** True when `output` is a checkpoint its worker reported (`reportProgress`). */
          checkpoint: z.literal(true).optional(),
          /** Its worker's last one-line progress note. */
          statusNote: z.string().optional(),
          error: z.string().optional(),
          ...waitingShape,
          followUpOf: z.string().optional(),
          filedByTask: z.string().optional(),
          run: taskSchema.shape.run,
          completedAt: z.number().optional(),
          /**
           * The latest follow-up in its chain that completed (FIX-2086 D3), with its
           * output cut as `output` is; absent when none did.
           */
          current: z
            .object({ id: z.string(), output: z.unknown().optional(), outputCut: z.literal(true).optional() })
            .optional(),
          /** The messages sent into it (FIX-2086 D1), oldest first; absent when none were. */
          steers: z
            .array(
              z.object({
                message: z.string(),
                from: z.enum(["filer", "user", "board"]),
                by: z.string().optional(),
                at: z.number(),
                /** The question it answers, by its hold's id (FIX-2133); absent on a steer that answers none. */
                answers: z.string().optional(),
                /** True once the task's current attempt read it. */
                taken: z.boolean(),
              }),
            )
            .optional(),
        }),
        /**
         * When this answer is how you hear the task failed or was cancelled: the
         * tasks you filed that depended on it, which that ending cancelled (FIX-2138).
         */
        cancelled: z.array(z.string()).optional(),
      }),
      /** A wait whose task's ending arrives as a notice, which the conversation hears on its own (FIX-2123). */
      z.object({ ok: z.literal(true), taskId: z.string(), arrivesAsNotice: z.literal(true), message: z.string() }),
      z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
    ]),
    execute: async (raw, ctx) => {
      const input = raw as { id: string; wait?: unknown; deadline?: unknown };
      // Read before anything else, and before the schema could have dropped
      // them: a wait this request can't make is refused by name.
      if (!wait && (input.wait !== undefined || input.deadline !== undefined)) {
        return {
          ok: false as const,
          taskId: input.id,
          error:
            "wait_unavailable: you can't wait on a task here, so getTask takes no wait or deadline. " +
            "Read it without them; you hear when it ends. Nothing was written.",
        };
      }
      if (input.deadline !== undefined && input.wait !== true) {
        return {
          ok: false as const,
          taskId: input.id,
          error: "deadline_without_wait: deadline bounds a wait, and this read doesn't wait. Set wait: true, or drop deadline.",
        };
      }
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      // As it stands now, not as this request first read the board: an ending
      // another request wrote since is the one to read (FIX-2082).
      await collection.refresh?.(input.id);
      let t: Task | undefined = collection.get(input.id);
      if (t === undefined) return taskNotFoundError(input.id);
      /** Whether this answer delivers the task's ending to its filer (FIX-2138). */
      let delivered = false;
      if (input.wait === true) {
        const call = toolCallOf(ctx);
        let waited: Awaited<ReturnType<typeof waitOnTask>> | undefined;
        try {
          waited =
            call === undefined
              ? undefined
              : await waitOnTask(ctx, collection, t.id, {
                  key: call.logicalId,
                  step: call.stepKey,
                  ...(typeof input.deadline === "number" ? { deadlineMs: input.deadline } : {}),
                });
        } catch (err) {
          // A wrapping ref's own refusal of the slot (FIX-2076's steps).
          if (err instanceof TaskWriteRefusedError) return refusedError(err);
          throw err;
        }
        if (waited === undefined) {
          return {
            ok: false as const,
            taskId: t.id,
            error: "wait_unavailable: only a model's own tool call can wait on a task. Nothing was written.",
          };
        }
        if (!waited.ok) return { ok: false as const, taskId: t.id, error: `${waited.error}: ${waited.message}` };
        // The filer's onTaskSettled took its ending first: that notice is the one hearing of it.
        if (waited.arrivesAsNotice === true) return arrivesAsNoticeAnswer(waited.task);
        t = waited.task;
        delivered = waited.delivered === true;
      } else {
        // The ending held for this request, when its wait on the task lapsed:
        // this read delivers it (FIX-2082).
        delivered = await deliverHeldEnding(ctx, collection, t);
      }
      // This answer is the filer's hearing of a failure or a cancel, in place of
      // its notice, so it names the dependents that ending cancelled, as the
      // notice would have (FIX-2138). A touch first cancels any the ending's
      // own cascade never read (FIX-2136); its names are read either way.
      let cancelled: string[] = [];
      if (delivered && (t.status === "errored" || t.status === "cancelled")) {
        try {
          await collection.payOwedCascades?.();
        } catch {
          // What it cancelled before failing is named below; the rest waits for the next touch.
        }
        cancelled = cancelledDependents(t, collection.list(), collection.filerOf?.bind(collection));
      }
      return {
        ok: true as const,
        task: readTaskView(t, collection.list()),
        ...(cancelled.length > 0 ? { cancelled } : {}),
      };
    },
  });

  // The filer's four.
  return [createTask, getTask, listTasks, updateTask];
}

/**
 * Build the `taskTools` handler tools directly (for pushing into a
 * generator's `tools:` array rather than composing the capability via `uses:`).
 *
 * These are a model's tools: only a generator's turn should call them. A
 * cancel through them counts as the model's own (FIX-2078 D2), so it owes the
 * filing session no notice. An app's or a person's move goes through
 * {@link taskToolActions}, whose cancel does owe one.
 *
 * @param roster Optional roster of the board's workers, fixed or read per call
 *   from the running context ({@link AssigneeRosterSource}). Supply it and
 *   `createTask` and `updateTask` reject an assignee it does not name.
 *   Omit it and assignment is unvalidated, as before.
 */
export function buildTaskToolsList(
  resolveCollection: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  nameSuffix?: string,
) {
  return buildTaskTools(resolveCollection, {
    ...(roster !== undefined ? { roster } : {}),
    ...(nameSuffix !== undefined ? { nameSuffix } : {}),
  });
}

// ---------------------------------------------------------------------------
// Capability factory
// ---------------------------------------------------------------------------

/**
 * Build the `taskTools` capability: the task tools registered under one capability
 * so consumers wire it via `uses: [createTaskToolsCapability(resolver)]`.
 *
 * @param resolveCollection The board resolver: a shared board, or a drain
 *   board for a fan-out worker.
 * @param roster Optional roster for assignee validation, fixed or read per call
 *   from the running context ({@link AssigneeRosterSource}). Supply it so a
 *   fan-out worker enqueuing follow-up tasks mid-drain is held to the same
 *   roster the executive is.
 * @param options `dispatches: true` on a board that starts a ready row at
 *   once, and `resumesWaits: true` when it has a waker, so `getTask` may offer
 *   `wait` ({@link TaskToolsOptions}).
 */
export function createTaskToolsCapability(
  resolveCollection: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  options: TaskToolsOptions = {},
): DefinedCapability {
  const forTurn = taskToolsForTurn(resolveCollection, roster, options);
  return defineCapability({
    name: "taskTools",
    presets: {
      tools: {
        // `controlTools`, not `tools` (FIX-1393): a task board is a framework
        // control, not a grant from the app's catalog. A block only holds these
        // because it asked for a board, and that composition is the
        // declaration. They are also unnameable: `buildTaskTools` mints them
        // per resolver, so a `tools:` list has no stable key to let them back
        // in. A worker declaring `tools: ["someCatalogTool"]` keeps its board.
        controlTools: forTurn,
      },
      default: ["tools"],
    },
  });
}

/**
 * How a board's task tools are offered. With `resumesWaits`, two lists of the
 * same task tools are built, one with the wait and one without; that is
 * deliberate, so a turn's tools are picked, never rebuilt.
 */
export interface TaskToolsOptions {
  /**
   * The board has a waker: the filing session's pass (its `onTaskSettled`
   * request, sent when a waited-on task ends) resumes a request parked on a
   * wait. Only then may `getTask` offer `wait` (FIX-2082). Default `false`: a
   * board that nothing wakes would leave every wait to its deadline.
   */
  readonly resumesWaits?: boolean;
  /**
   * The board starts a ready row at once (FIX-1875): its ref's writes wake
   * whatever runs it, so a `createTask` starts the work now, and files each
   * row once per call. Default `false`: a board a drain runs decides for
   * itself when each row runs.
   */
  readonly dispatches?: boolean;
}

/**
 * The task tools as a turn gets them: a list of the same names per kind of
 * turn (waiting or not), each built once, and the one
 * the turn can use: the filer's four. `getTask` carries `wait`
 * and `deadline` only on a board that resumes waits (`options.resumesWaits`)
 * and a host that can hold and bound one ({@link canHoldWait}). `createTask`
 * never waits.
 *
 * For a composing layer that builds its own capability over a board (pass
 * the result as a preset's `controlTools`, or call it from one).
 */
export function taskToolsForTurn(
  resolveCollection: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  options: TaskToolsOptions = {},
): (ctx: object) => GeneratorTool[] {
  const base: BuildTaskToolsOptions = {
    ...(roster !== undefined ? { roster } : {}),
    dispatches: options.dispatches === true,
  };
  const waits = options.resumesWaits === true;
  // One list per kind of turn, built once, the first time a turn needs it.
  const lists = new Map<boolean, GeneratorTool[]>();
  const listFor = (wait: boolean): GeneratorTool[] => {
    let list = lists.get(wait);
    if (list === undefined) {
      list = buildTaskTools(resolveCollection, { ...base, ...(wait ? { wait: true } : {}) });
      lists.set(wait, list);
    }
    return list;
  };
  // The plain list now, so a board that can't build its tools fails at wiring.
  listFor(false);
  return (ctx) => listFor(waits && canHoldWait(ctx as Pick<BlockContext, "requestHost">));
}


// ---------------------------------------------------------------------------
// The task tools as flow actions
// ---------------------------------------------------------------------------

/**
 * The qualifier that makes one board's task tools distinct from
 * another's: the board's collection id with every character a provider does
 * not allow in a tool name (`[a-zA-Z0-9_-]`) turned into `_`. So
 * `eng.feature.work`'s tools are `updateTask_eng_feature_work`.
 *
 * **Pinned.** It is the name a model is told about on a dotted board and the
 * name an action carries under {@link taskToolActions}, and the DevTool scopes
 * a row's actions to its board by it.
 */
export function taskToolSuffix(collectionId: string): string {
  return collectionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * What {@link taskToolActions} reads off a board handle. Structural, so this
 * module does not import the task-board barrel.
 */
export interface TaskToolActionsBoard {
  readonly collectionId: string;
  readonly backing: string;
  /** Composed by each action, so the board's ledger is installed with it. */
  readonly capability: DefinedCapability;
}

/**
 * A durable board's task tools as a flow `actions` map, named
 * `<tool>_<suffix>` ({@link taskToolSuffix}). Spread it into `defineFlow`'s
 * `actions` to let a caller — a person in the DevTool, an app's own screen —
 * change a task from outside the run that works it.
 *
 * Each action runs the same block a model's tool does, so every rule in the
 * field table holds for a screen as for a model: a move the task cannot make
 * comes back as `{ ok: false, error }` naming the rule, and writes nothing.
 * None of them claims, drains or settles the board, and `reportProgress` has
 * no action. An action holds no claim: its cancel lands on a row a worker
 * holds, and that worker's later result is declined. The engine refuses a
 * session to another user, so an action acts as the signed-in user.
 *
 * Two forms:
 *
 * - `taskToolActions(board, roster?)` — a `taskBoard()` handle. Its rows are
 *   reached through the board's own resolver, and each action composes the
 *   board's capability, so the flow need not declare the collection again.
 * - `taskToolActions(collectionId, resolve, roster?)` — for a caller that
 *   resolves a durable ledger itself, to fence each action to its own
 *   session.
 *
 * Pass a `roster` and the actions check assignees the way the model's tools
 * do: `createTask` and `updateTask` refuse one the roster does not
 * name, with the same `unknown_assignee` answer, and write nothing. It may be a
 * function of the running context, read per call ({@link AssigneeRosterSource}),
 * for a board whose team changes while it is in use. Without one, any assignee
 * is accepted, as before.
 *
 * Pass `{ dispatches: true }` for a board that starts a ready row at once
 * ({@link TaskToolsOptions.dispatches}): `createTask_<suffix>` then starts
 * the row it files. No action waits: an action has no request to park, so
 * `getTask_<suffix>` refuses `wait` by name.
 *
 * These are public actions: anyone who can call the flow can call them.
 *
 * The qualifier is not injective: `a.b` and `a_b` both give `a_b`. A flow that
 * spreads two boards' actions whose ids qualify alike gets one set of names,
 * and the later spread replaces the earlier. Give such boards distinct ids.
 *
 * @throws When the board's backing is not `resource`. A request- or
 *   sequencer-backed ledger is gone when the request that filed its rows ends,
 *   so a later action could never find them.
 */
export function taskToolActions(
  board: TaskToolActionsBoard,
  roster?: AssigneeRosterSource,
): Record<string, ActionConfig>;
export function taskToolActions(
  collectionId: string,
  resolve: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  options?: Pick<TaskToolsOptions, "dispatches">,
): Record<string, ActionConfig>;
export function taskToolActions(
  boardOrId: TaskToolActionsBoard | string,
  resolveOrRoster?: TaskCollectionResolver | AssigneeRosterSource,
  rosterForId?: AssigneeRosterSource,
  actionOptions: Pick<TaskToolsOptions, "dispatches"> = {},
): Record<string, ActionConfig> {
  let collectionId: string;
  let resolve: TaskCollectionResolver;
  let uses: DefinedCapability[] | undefined;
  let roster: AssigneeRosterSource | undefined;
  if (typeof boardOrId === "string") {
    const resolveCollection = resolveOrRoster as TaskCollectionResolver | undefined;
    if (resolveCollection === undefined) {
      throw new Error(
        `taskToolActions("${boardOrId}") needs a resolver for the ledger as its second argument.`,
      );
    }
    collectionId = boardOrId;
    resolve = resolveCollection;
    roster = rosterForId;
  } else {
    collectionId = boardOrId.collectionId;
    roster = resolveOrRoster as AssigneeRosterSource | undefined;
    if (boardOrId.backing !== "resource") {
      throw new Error(
        `taskToolActions: board "${collectionId}" is ${boardOrId.backing}-backed, and its tasks ` +
          `do not outlive the request that filed them, so a later action could never find ` +
          `them. Give the board a durable collection: \`collection: defineTaskCollection(...)\`.`,
      );
    }
    const recorded = boardResolverOf(boardOrId);
    if (recorded === undefined) {
      throw new Error(
        `taskToolActions: board "${collectionId}" was not built by taskBoard(). Pass ` +
          `\`taskToolActions(collectionId, resolve)\` for a ledger you resolve yourself.`,
      );
    }
    resolve = recorded;
    uses = [boardOrId.capability];
  }
  return Object.fromEntries(
    buildTaskTools(resolve, {
      ...(roster !== undefined ? { roster } : {}),
      nameSuffix: taskToolSuffix(collectionId),
      ...(uses !== undefined ? { uses } : {}),
      claimless: true,
      dispatches: actionOptions.dispatches === true,
    }).map((tool) => [
      tool.name,
      { block: tool, description: tool.description },
    ]),
  );
}

/**
 * A durable ledger's task list as a flow `reads` map (FIX-2286):
 * `listTasks_<suffix>`, answering exactly what the `listTasks_<suffix>` action
 * answers for the same board, from the same list code, and storing nothing.
 * Spread it into `defineFlow`'s `reads` so an app can watch a session's board
 * without a request per look.
 *
 * `resolve` is the read's own resolver: it must reach the board the action's
 * does and write nothing on the way, since a read's context refuses every
 * write. A resolver that repairs or starts rows as it goes (a board's touch)
 * is the action's, not this one's. Only the list is a read: `getTask` can
 * wait, which holds a wait slot on the row.
 */
export function taskToolReads(
  collectionId: string,
  resolve: TaskCollectionResolver,
): Record<string, ReadConfig> {
  const listTasks = buildTaskTools(resolve, {
    nameSuffix: taskToolSuffix(collectionId),
    claimless: true,
  }).find((tool) => tool.name === `listTasks_${taskToolSuffix(collectionId)}`);
  if (listTasks === undefined) throw new Error(`taskToolReads("${collectionId}"): the task tools built no listTasks`);
  return { [listTasks.name]: { block: listTasks, description: listTasks.description } };
}
