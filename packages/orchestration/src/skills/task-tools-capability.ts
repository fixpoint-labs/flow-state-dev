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
 * completed follow-up as `current`. `answerTask` answers a task parked on its
 * worker's question, until FIX-2058.
 *
 * Nothing on this surface settles a task: a task ends when its worker returns
 * or throws, and the drain or the claim gate records that. The worker's own
 * tool, `reportProgress` (`createReportProgress`), reports a note and a
 * checkpoint of its output while it runs; the question park,
 * `parkOnQuestion` (`createParkOnQuestion`), asks a question. Both act on the
 * row the turn's claim holds, never on a task id from input.
 *
 * ## Dispatching (FIX-1875)
 *
 * On a board that starts a ready row at once (`TaskToolsOptions.dispatches`,
 * a conversation's board), `dispatchTask` stays beside them until FIX-2082 and
 * FIX-2083 replace its wait and its post form: a new row (`goal`, with
 * `createTask`'s fields and checks), or a held row (`taskId`), released by the
 * collection's one conditional `dispatch` write. With `wait`, the turn parks
 * on it until the task ends. Exactly one of `goal` and `taskId`, and no owner
 * it can resolve is refused (`assignee_required`), each before anything is
 * written. Its reassign obeys the field table: it releases a held row only.
 *
 * `createTask` starts a task as its start setting says: at once, after its
 * `deps`, or `held` until a release.
 *
 * Board resolution goes through the resolver the caller passes (FIX-918). With
 * no board resolvable, every tool returns
 * `{ ok: false, error: "no_delegation_board" }` rather than throwing.
 *
 * ## Waiting for the answer (FIX-1816)
 *
 * On a turn whose host can hold a wait (durable execution, and a durability
 * sweeper that times waits out: `RequestHost.hasWaitSweeper`), `dispatchTask`
 * takes two more flat fields: `wait`, which parks the turn until the task
 * ends, returning its output as `answer`; and `timeoutMs`, the wait's bound.
 * Anywhere else the fields are not in the schema. The `dispatchTask_<board>`
 * action never waits. `createTask` never waits: it refuses the fields it used
 * to take for it by name, rather than letting the schema drop them.
 */

import { defineCapability, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { ActionConfig, BlockContext } from "@flow-state-dev/core/types";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import {
  ticketForClaim,
  isTerminalStatus,
  lockedFields,
  taskSchema,
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
} from "../tasks";
// The board's per-worker claim seam. A deep import for the same reason
// `shouldRetryOnFail` is one: this surface consumes the seam, it does not widen
// the task-board's public API to advertise it.
import { currentWorkerClaim } from "../task-board/flow-policy-wiring";
// The resolver `taskBoard()` recorded for its handle, read without importing
// the task-board barrel (which imports this module's neighbours).
import { boardResolverOf } from "../task-board/board-resolver";
// The one task-turn test (FIX-1816 BR-5a), owned by the task-board.
import { isTaskTurn } from "../task-board/task-turn";
import {
  dispatchAndWait,
  canHoldWait,
  MAX_WAIT_TIMEOUT_MS,
  MIN_WAIT_TIMEOUT_MS,
  notDispatchableMessage,
  toolCallOf,
  type DispatchAndWaitResult,
} from "../tasks/helpers/wait-for-response";

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
   * exactly one; `undefined` otherwise. Read by `dispatchTask`, which refuses
   * (`assignee_required`) rather than start a row nobody would take
   * (FIX-1875 BR-24). Optional: a roster without it names no default.
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
 * `answerTask` and the question park report it, and they must not drift into
 * two ways of saying the same thing: one sentence shape, one `snake_case`
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
 * `heldTaskId` is present exactly when a ticket was presented, which is exactly
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
  heldTaskId?: string,
) => {
  if (declined.reason === "terminal") {
    return terminalWriteToolError({
      code: "terminal_task_write_declined",
      taskId,
      status: declined.status,
      clause,
    });
  }
  if (declined.reason === "awaiting-answer") return awaitingAnswerError(taskId);
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
  if (declined.reason === "not-my-task" && heldTaskId !== undefined) {
    return {
      ok: false as const,
      taskId,
      error:
        `task_write_declined: you hold task "${heldTaskId}", not "${taskId}". ` +
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

/**
 * Why `answerTask` can't answer `task`, or `undefined` when it is parked on a
 * question. A terminal row answers as every other write to one does; anything
 * else isn't waiting on an answer.
 */
function notParkedOnQuestion(task: Task) {
  if (isTerminalStatus(task.status)) {
    return terminalWriteToolError({
      code: "terminal_task_write_declined",
      taskId: task.id,
      status: task.status,
      clause: STATUS_CLAUSE,
    });
  }
  if (task.status !== "parked") {
    return {
      ok: false as const,
      taskId: task.id,
      error:
        `not_parked_on_question: task "${task.id}" is ${task.status}, so it isn't waiting ` +
        `on an answer. Nothing was written.`,
    };
  }
  if (task.parkedOnQuestion !== true) {
    return {
      ok: false as const,
      taskId: task.id,
      error:
        `not_parked_on_question: task "${task.id}" is parked, but not on its worker's ` +
        `question (it may be waiting on its own sub-tasks). Nothing was written.`,
    };
  }
  return undefined;
}

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
 * The refusal for reassigning a task an answer has re-queued and that hasn't
 * run again yet. Lifts once the re-entry is claimed.
 */
const awaitingAnswerError = (taskId: string) => ({
  ok: false as const,
  taskId,
  error:
    `task_awaiting_answer: task "${taskId}" was just answered and is about to pick up again ` +
    `with its worker, in the session that filed it. Reassign it after that run starts. Nothing was written.`,
});

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

/** Where a task turn's own tools (`parkOnQuestion`, `reportProgress`) read the row the turn holds. */
export interface ParkOnQuestionOptions {
  /**
   * The ledger the running task turn's row is on, or `undefined` when this
   * flow can't reach it. Resolve from server-set state only (a task session's
   * birth fields, say), never from input (BP-031).
   */
  resolve: (ctx: BlockContext) => Promise<TaskCollectionRef | undefined>;
}

/** {@link createReportProgress}'s options: where it reads the row the turn holds. */
export type ReportProgressOptions = ParkOnQuestionOptions;

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
async function heldRowOf(
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
  // Any status: a row this turn held and that has since parked, settled or
  // been cancelled is still this turn's, and a write declines naming it.
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
 * - **Which row.** The one the turn holds ({@link heldRowOf}), never an id
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
      const held = await heldRowOf(options.resolve, ctx);
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
      const held = await heldRowOf(options.resolve, ctx);
      return held !== undefined && held.row?.status === "in_progress";
    },
  };
}

/**
 * The worker's question park (FIX-1817 S1): `parkOnQuestion({ question })`,
 * for a task turn, and the rule for when a turn is offered it.
 *
 * - **Which row.** The one the turn holds ({@link heldRowOf}), never a task
 *   id from input.
 * - **The park.** `awaitReview` with the question, fenced by that ticket and
 *   to a running row (`fromRunning`), so it is declined once the claim was
 *   displaced (a cancel landed) and once the row has already parked this
 *   attempt, for its question or for anything else. A task waits on one
 *   thing at a time.
 * - **When it is offered** (`offered`). On a task turn ({@link isTaskTurn})
 *   that holds a running row, when the row isn't waited on: in v1 a waited-on task's worker
 *   answers with what it has, or fails (epic ER-22).
 *
 * The turn's own answer after a park is not recorded: the board refuses to
 * settle a parked row from its worker's result (FIX-1234).
 */
export function createParkOnQuestion(options: ParkOnQuestionOptions) {
  const claimedRow = (ctx: BlockContext) => heldRowOf(options.resolve, ctx);

  const tool = handler({
    name: "parkOnQuestion",
    description:
      "Stop work on the task you are running and ask the person who assigned it a question " +
      "you can't go on without: which region, which account, whether you may delete " +
      "something. The task waits, and your next turn in this session is their answer. " +
      "Use it instead of guessing. After calling it, end your turn with a short note; " +
      "nothing you answer now is recorded as the task's result.",
    inputSchema: z.object({ question: z.string().min(1) }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), taskId: z.string(), status: z.literal("parked") }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    execute: async (input, ctx) => {
      const held = await claimedRow(ctx);
      if (held === undefined) {
        return {
          ok: false as const,
          error: "not_a_task_turn: this turn isn't running a task, so there is no task to park.",
        };
      }
      const { claim, ledger, row } = held;
      if (row?.wait !== undefined) {
        return {
          ok: false as const,
          error:
            `waited_on_task: task "${claim.taskId}" was dispatched to you by a turn that is waiting ` +
            `for it. Answer with what you have, or end your turn with an error.`,
        };
      }
      const outcome: TaskWriteOutcome | undefined = await ledger.awaitReview(claim.taskId, input.question, {
        claim,
        fromRunning: true,
        onQuestion: true,
      });
      if (outcome == null || outcome.outcome === "declined") {
        const status = outcome?.status ?? ledger.get(claim.taskId)?.status ?? "unknown";
        return {
          ok: false as const,
          error:
            `park_declined: task "${claim.taskId}" is ${status}, so it can't wait on your ` +
            `question now. Nothing was written.`,
        };
      }
      return { ok: true as const, taskId: claim.taskId, status: "parked" as const };
    },
  });

  return {
    /** The tool, for a task turn's tool list. */
    tool,
    /** Whether the running turn is offered the tool: a task turn holding a claim on a row that isn't waited on. */
    offered: async (ctx: BlockContext): Promise<boolean> => {
      const held = await claimedRow(ctx);
      return held !== undefined && held.row?.status === "in_progress" && held.row.wait === undefined;
    },
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
   * Offer the wait: `dispatchTask`'s `wait`, with `timeoutMs`. Only the
   * capability's per-turn tool list sets it, on a host that can hold a wait
   * ({@link canHoldWait}).
   */
  readonly wait?: boolean;
  /**
   * Add `dispatchTask` (FIX-1875): the board starts a ready row at once, so a
   * dispatch means work starts now ({@link TaskToolsOptions.dispatches}). And
   * `createTask` files each row once per call, since filing starts it.
   */
  readonly dispatches?: boolean;
  /**
   * Offer `dispatchTask`'s post form: `post: true`, with `assignee` and
   * `target`, handed to this form to file ({@link TaskToolsOptions.posts}).
   * Only the per-turn list sets it, on a turn the form says is routing one.
   */
  readonly posting?: DispatchPostForm;
  /** What a task turn is told to do instead of waiting ({@link TaskToolsOptions.taskTurnInstead}). */
  readonly taskTurnInstead?: string;
}

function buildTaskTools(resolve: TaskCollectionResolver, options: BuildTaskToolsOptions = {}) {
  const { roster, nameSuffix, uses, claimless = false, wait = false, dispatches = false, posting, taskTurnInstead } = options;
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

  const createTaskDescription =
    "File a new task on your delegation board. Returns the new task id. " +
    "assignee names one of your delegates; leave it unset only when you have one delegate. " +
    "The task starts as its start setting says: at once; after deps, task ids on this board " +
    "that must finish first; or, with held: true, once you release it with updateTask " +
    "({ id, status: \"pending\" }). input is a structured payload for the worker. " +
    "maxAttempts is how many tries it gets in all. Every field can change with updateTask until " +
    "the task first starts; after that only a cancel. The board may bound how many tasks wait " +
    "at once and how many it may hold in total: enqueued_task_cap_exceeded means too many tasks " +
    "are already waiting to run, and total_task_cap_exceeded is the lifetime ceiling, which " +
    "draining does not reset. Working a task yourself, end your turn once you have filed its " +
    "pieces: each piece's ending wakes you with its result.";
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
          "worker, so leave assignee unset; if that session is still working a task, it starts " +
          "once that task ends.",
      ),
    held: z
      .boolean()
      .optional()
      .describe("File the task held: it doesn't start until you release it with updateTask."),
    session: z
      .enum(["new", "ongoing"])
      .optional()
      .describe("Where it runs: a session of its own (new, the default), or the delegate's ongoing session."),
    resultTo: z
      .enum(["filer", "conversation"])
      .optional()
      .describe("Who hears its result: you (filer, the default), or the conversation, under the delegate's name."),
    maxAttempts: z.number().int().positive().optional().describe("How many tries the task gets in all."),
    // Every field `updateTask` edits is one a filing sets, plus the filing-only keys above.
  } satisfies Record<TaskUpdateField, z.ZodTypeAny> & Record<string, z.ZodTypeAny>;
  type NewTaskInput = z.infer<z.ZodObject<typeof createTaskFields>>;
  /**
   * The fields a filing once took to wait (FIX-1816), refused by name: the
   * wait is `dispatchTask`'s until FIX-2082 (FIX-1875 BR-21). Read from the
   * call's input before anything else: the schema doesn't name them, so a
   * plain parse would drop them and file a task the caller thinks it waits on.
   */
  const RETIRED_WAIT_FIELDS = ["waitForResponse", "timeoutMs"] as const; // retired-name-refusal
  type FollowUp = { root: string; assignee: string | undefined; id: string };

  /**
   * A decision read from the roster, which can change between a call and its
   * replay: recorded with the call when `memoize`, so the replay of a call
   * that already filed or readied its row decides as the first call did, and
   * reaches its own write instead of a refusal (FIX-1875 BR-15). `null`
   * stands for "nothing to refuse" in the record, which holds JSON only.
   */
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
   * A new task's checks, in their order, run by `createTask` and
   * `dispatchTask` alike so the two refuse identically (FIX-1875 BR-14): the
   * follow-up (in this board's partition only), then the assignee against the
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
    // The task whose request files this one, from the worker's own claim:
    // server-set, never input (BP-031). An action holds none.
    const filedByTask = claimless ? undefined : currentWorkerClaim(ctx)?.taskId;
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
        // A caller's metadata never carries a notice marker (BP-031).
        ...(input.metadata !== undefined ? { metadata: withoutNoticeMarkers(input.metadata) } : {}),
        ...(input.held === true ? { held: true } : {}),
        ...(input.session !== undefined ? { session: input.session } : {}),
        ...(input.resultTo !== undefined ? { resultTo: input.resultTo } : {}),
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

  /** A wait's result as the tools answer it: the answer, or the error code and its message. */
  const waitAnswer = (result: DispatchAndWaitResult) =>
    result.ok
      ? { ok: true as const, taskId: result.taskId, answer: result.answer }
      : {
          ok: false as const,
          error: result.message === undefined ? result.error : `${result.error}: ${result.message}`,
          ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
        };

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
      const retired = RETIRED_WAIT_FIELDS.filter((field) => input[field] !== undefined);
      if (retired.length > 0) {
        return {
          ok: false as const,
          error:
            `create_task_does_not_wait: createTask takes no ${retired.join(" or ")}; it only files a task. ` +
            (dispatches
              ? "To start a task now and wait for its result, call dispatchTask with the same fields and wait: true. "
              : "This board has no tool that waits for a task. ") +
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
      // Recorded with the call on a board that starts work, so a replay decides as the first call did.
      const checked = await checkNewTask(ctx, collection, input, dispatches);
      if ("error" in checked) return checked;
      return fileNewTask(checked.followUp, async () => {
        // On a board that starts a ready row at once, a filing starts work:
        // once per call, so a replay finds its own row (BR-15).
        const filed = dispatches
          ? await fileReady(ctx, collection, checked.init)
          : { ok: true as const, taskId: (await collection.addTask(checked.init)).id };
        return input.held === true ? { ...filed, status: "held" as const } : filed;
      });
    },
  });

  // -------------------------------------------------------------------------
  // dispatchTask (FIX-1875): start work on another worker now, and optionally
  // wait for it. Offered only on a board that starts a ready row at once.
  // -------------------------------------------------------------------------

  const dispatchDescription =
    "Start a task on another worker now. Give goal to start a new task, with the fields " +
    "createTask takes, or taskId to start a task held earlier on this board. " +
    "assignee names the worker; leave it unset only when there is a single worker to " +
    "give it to. Returns the task id at once, without waiting for the task to run, and " +
    "you hear when it ends.";
  const dispatchWaitDescription =
    " Set wait to true when your next step needs the task's result: you wait until it " +
    "ends and get its output back as answer. Only one waiting call per step. timeoutMs " +
    "bounds the wait, from 30000 (30 seconds) to 3600000 (an hour), five minutes when " +
    "unset, and is only valid with wait. Errors: wait_timed_out (it didn't end in time; it " +
    "is cancelled), wait_task_failed, wait_task_cancelled, wait_already_pending, " +
    `wait_unavailable (you are working a task yourself, so you can't wait${taskTurnInstead === undefined ? "" : `: ${taskTurnInstead}`}), ` +
    "wait_timeout_out_of_range.";
  const dispatchFields = {
    ...createTaskFields,
    goal: z.string().optional().describe("What the new task is for. Omit it when you give taskId."),
    taskId: z
      .string()
      .optional()
      .describe("A task held earlier on this board that hasn't started, to start instead of a new one."),
  };
  const dispatchPostFields = {
    post: z
      .literal(true)
      .optional()
      .describe("Hand on the post being routed on this turn, instead of a new task. Send only assignee and target with it."),
    target: z
      .string()
      .optional()
      .describe("With post: where the post is worked, for an assignee that names one. Only with post."),
  };
  const dispatchWaitFields = {
    wait: z.boolean().optional().describe("Wait for the task to end and return its output as answer."),
    timeoutMs: z
      .number()
      .optional()
      .describe(
        `How long to wait, in ms: ${MIN_WAIT_TIMEOUT_MS} to ${MAX_WAIT_TIMEOUT_MS}. Five minutes when unset. Only with wait.`,
      ),
  };
  type DispatchInput = Omit<NewTaskInput, "goal"> & {
    goal?: string;
    taskId?: string;
    wait?: unknown;
    timeoutMs?: unknown;
    post?: unknown;
    target?: unknown;
  };
  /** The fields a post takes: everything else describes a task, which a post isn't. */
  const POST_FIELDS = new Set(["post", "assignee", "target"]);
  /** The fields only a new task takes, refused beside `taskId` (BR-13): change a held task with updateTask first. */
  const NEW_TASK_ONLY = [
    "title",
    "context",
    "deps",
    "priority",
    "input",
    "labels",
    "metadata",
    "followUpOf",
    "held",
    "session",
    "resultTo",
    "maxAttempts",
  ] as const;

  /**
   * The owner a dispatch starts the row with (BR-24): the one named, else the
   * row's own, else the board's sole worker. `undefined` means nobody would
   * take it, and the call is refused before anything is written.
   */
  const ownerFor = async (ctx: BlockContext, named: string | undefined): Promise<string | undefined> =>
    named ?? (await rosterFor(roster, ctx))?.soleAssignee?.();

  const assigneeRequiredError = {
    ok: false as const,
    error:
      "assignee_required: there is more than one worker this task could go to, and none was " +
      "named, so nothing would start it. Name one with assignee. Nothing was filed.",
  };

  /**
   * File a new row ready, once per call: its id is recorded with the call, and
   * the row carries the call (`dispatchCall`), so a replay after a crash finds
   * its own row instead of filing a second (BR-15). Where the turn carries no
   * tool call or no `runOnce`, it is the unguarded path: a plain `addTask`,
   * with no replay protection.
   */
  async function fileReady(ctx: BlockContext, collection: TaskCollectionRef, init: TaskInit) {
    const call = toolCallOf(ctx);
    if (call === undefined || ctx.runOnce === undefined) {
      const task = await collection.addTask(init);
      return { ok: true as const, taskId: task.id };
    }
    const id = await ctx.runOnce(
      `fsd.dispatch.plan:${call.logicalId}`,
      // The board's own id shape: twenty hex characters, unique across processes.
      async () => init.id ?? `task_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    );
    if (collection.get(id)?.dispatchCall === call.logicalId) return { ok: true as const, taskId: id };
    const task = await collection.addTask({ ...init, id, dispatchCall: call.logicalId });
    return { ok: true as const, taskId: task.id };
  }

  const dispatchTask = defineTool({
    name: named("dispatchTask"),
    description:
      (wait ? dispatchDescription + dispatchWaitDescription : dispatchDescription) +
      (posting !== undefined ? ` ${posting.description}` : ""),
    // Not `.strict()`: FIX-1872 adds its post form to this schema. Passthrough,
    // so a field this board doesn't offer reaches `execute` to be refused by
    // name rather than stripped by the parse (BR-18).
    inputSchema: z
      .object({
        ...dispatchFields,
        ...(wait ? dispatchWaitFields : {}),
        ...(posting !== undefined ? dispatchPostFields : {}),
      })
      .passthrough(),
    outputSchema: z.union([
      z.object({
        ok: z.literal(true),
        taskId: z.string().optional(),
        answer: z.unknown().optional(),
        note: z.string().optional(),
      }),
      z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
    ]),
    execute: async (raw, ctx) => {
      const input = raw as DispatchInput;
      // Read before anything else, and before the schema could have dropped
      // them: a wait this board or host can't hold is refused by name.
      if (!wait && (input.wait !== undefined || input.timeoutMs !== undefined)) {
        return {
          ok: false as const,
          error:
            "wait_unavailable: this call can't wait here, so it takes no wait or timeoutMs. " +
            "Dispatch without them, and you hear when the task ends. Nothing was filed.",
        };
      }
      if (posting === undefined && (input.post !== undefined || input.target !== undefined)) {
        return {
          ok: false as const,
          error: "post_unavailable: there is no post being routed on this turn to hand on. Nothing was filed.",
        };
      }
      if (posting !== undefined && input.post !== undefined) {
        const extra = Object.keys(input).filter(
          (field) => !POST_FIELDS.has(field) && (input as Record<string, unknown>)[field] !== undefined,
        );
        if (input.post !== true || extra.length > 0) {
          return {
            ok: false as const,
            error:
              `post_takes_assignee_and_target: a post is handed on as it was written, so send ` +
              `post: true with assignee and, where it names one, target, and nothing else` +
              (extra.length > 0 ? ` (not ${extra.join(", ")})` : "") +
              ". Nothing was filed.",
          };
        }
        if (input.assignee !== undefined && typeof input.assignee !== "string") {
          return { ok: false as const, error: "post_takes_assignee_and_target: assignee is a name. Nothing was filed." };
        }
        if (input.target !== undefined && typeof input.target !== "string") {
          return { ok: false as const, error: "post_takes_assignee_and_target: target is a name. Nothing was filed." };
        }
        return posting.file(ctx, {
          ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
          ...(input.target !== undefined ? { target: input.target as string } : {}),
        });
      }
      if (input.target !== undefined) {
        return {
          ok: false as const,
          error:
            "target_without_post: target says where a post is worked, and this call files a task. " +
            "Send post: true to hand the post on, or drop target. Nothing was filed.",
        };
      }
      const hasGoal = input.goal !== undefined;
      const hasRef = input.taskId !== undefined;
      if (!hasGoal && !hasRef) {
        return {
          ok: false as const,
          error:
            "dispatch_target_required: give goal to start a new task, or taskId to start one " +
            "held earlier. Nothing was filed.",
        };
      }
      if (hasGoal && hasRef) {
        return {
          ok: false as const,
          error:
            "dispatch_target_ambiguous: give goal for a new task or taskId for a held one, " +
            "not both. Nothing was filed.",
        };
      }
      if (input.timeoutMs !== undefined && input.wait !== true) {
        return {
          ok: false as const,
          error:
            "wait_timeout_without_wait: timeoutMs bounds a wait, and this call doesn't wait. " +
            "Set wait: true, or drop timeoutMs. Nothing was filed.",
        };
      }
      const timeout = {
        ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
        ...(taskTurnInstead !== undefined ? { taskTurnInstead } : {}),
      };

      if (hasRef) {
        const taskId = input.taskId!;
        const extra = NEW_TASK_ONLY.filter((field) => input[field] !== undefined);
        if (extra.length > 0) {
          return {
            ok: false as const,
            error:
              `dispatch_ref_takes_no_task_fields: ${extra.join(", ")} only describe a new task. ` +
              `To change task "${taskId}" before it starts, call updateTask first. Nothing was written.`,
          };
        }
        const collection = await resolve(ctx);
        if (!collection) return noBoardError;
        const row = collection.get(taskId);
        if (!row) return taskNotFoundError(taskId);
        // Recorded with the call (BR-15): a replay after the team changed
        // decides as the first call did, and reaches its own write.
        const decided = await decideOnce(ctx, true, "owner", async () => {
          const bad =
            input.assignee === undefined
              ? undefined
              : checkAssignee(input.assignee, await rosterFor(roster, ctx));
          return bad ?? { owner: (await ownerFor(ctx, input.assignee ?? row.assignee)) ?? null };
        });
        if ("error" in decided) return decided;
        if (decided.owner === null) return assigneeRequiredError;
        // An owner the call names is always written, even the row's own: an
        // updateTask landing between this read and the write must not stand
        // over the later dispatch (BR-25). Only an inherited owner is left out.
        const assignee =
          input.assignee !== undefined || decided.owner !== row.assignee ? decided.owner : undefined;
        if (collection.dispatch === undefined && input.wait !== true) {
          return {
            ok: false as const,
            taskId,
            error: `task_not_dispatchable: this board can't start task "${taskId}" by its id. Nothing was written.`,
          };
        }
        const call = toolCallOf(ctx)?.logicalId ?? `call_${crypto.randomUUID()}`;
        let outcome: TaskWriteOutcome;
        try {
          if (input.wait === true) {
            return waitAnswer(
              await dispatchAndWait(ctx, collection, { taskId, ...(assignee !== undefined ? { assignee } : {}) }, timeout),
            );
          }
          outcome = await collection.dispatch!(taskId, {
            call,
            ...(assignee !== undefined ? { assignee } : {}),
          });
        } catch (err) {
          // A wrapping ref's own rule refused the dispatch (FIX-2076).
          if (err instanceof TaskWriteRefusedError) return refusedError(err);
          throw err;
        }
        if (outcome.outcome === "declined") {
          return { ok: false as const, taskId, error: `task_not_dispatchable: ${notDispatchableMessage(taskId, outcome)}` };
        }
        return { ok: true as const, taskId };
      }

      if (input.followUpOf !== undefined && input.assignee !== undefined) {
        return followUpAssigneeError(input.followUpOf);
      }
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const checked = await checkNewTask(ctx, collection, { ...input, goal: input.goal! }, true);
      if ("error" in checked) return checked;
      const owner = await decideOnce(ctx, true, "owner", async () => (await ownerFor(ctx, checked.init.assignee)) ?? null);
      if (owner === null) return assigneeRequiredError;
      const init: TaskInit = { ...checked.init, assignee: owner };
      return fileNewTask(checked.followUp, async () =>
        input.wait === true ? waitAnswer(await dispatchAndWait(ctx, collection, init, timeout)) : fileReady(ctx, collection, init),
      );
    },
  });

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
      "follow-up instead. A refusal names the rule.",
    inputSchema: z.object({
      id: z.string(),
      ...updateFields,
      status: z.enum(["held", "pending", "cancelled"]).optional(),
      message: z
        .string()
        .min(1)
        .optional()
        .describe("Words for the task while it is open, sent alone: they join its brief. Uses no try, never cancels."),
    }),
    outputSchema: z.union([
      // A cancel names the dependents it took along (FIX-2078 D2).
      z.object({ ok: z.literal(true), cancelled: z.array(z.string()).optional() }),
      z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
    ]),
    execute: async (input, ctx) => {
      const fields = UPDATE_FIELDS.filter((field) => input[field] !== undefined);
      const message = input.message;
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
          const outcome: TaskWriteOutcome | undefined = await collection.cancel(input.id, undefined, {
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
        if ((current.steers?.length ?? 0) >= MAX_STEERS) return steerLimitError(input.id);
        if (collection.steer === undefined) {
          return {
            ok: false as const,
            taskId: input.id,
            error: `message_not_supported: task "${input.id}"'s board takes no message. Nothing was written.`,
          };
        }
      }
      if (input.assignee !== undefined && input.assignee !== current.assignee) {
        if (current.answered === true) return awaitingAnswerError(input.id);
        const bad = checkAssignee(input.assignee, await rosterFor(roster, ctx));
        if (bad) return bad;
      }
      if (fields.length > 0 || input.status !== undefined) {
        const patch: TaskSettingsPatch = {
          ...(input.status === "held" ? { held: true } : {}),
          ...(input.status === "pending" ? { held: false } : {}),
          ...Object.fromEntries(fields.map((field) => [field, input[field]])),
          // Nor can a patch forge, clear or settle a notice marker (BP-031, FIX-2078).
          ...(input.metadata !== undefined ? { metadata: withoutNoticeMarkers(input.metadata) } : {}),
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

  const listTasks = defineTool({
    name: named("listTasks"),
    description:
      "List tasks on your delegation board, optionally filtered by status, assignee, or the task " +
      "whose request filed them (filedByTask). Rows carry each task's status note, never its output: " +
      "read one task's output with getTask. Don't list to wait for a task you filed to end: end " +
      "your turn, and its ending wakes you.",
    inputSchema: z.object({
      status: z
        .enum(["pending", "in_progress", "held", "parked", "completed", "errored", "cancelled"])
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
            /** A turn is waiting on this task's answer (`dispatchTask` with `wait`). */
            waitedOn: z.literal(true).optional(),
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
          ...(t.wait != null ? { waitedOn: true as const } : {}),
          ...withCurrentId(currentFor(t, latest.get(t.followUpOf ?? t.id))),
        })),
      };
    },
  });

  const getTask = defineTool({
    name: named("getTask"),
    description:
      "Read one task on your delegation board in full: what it was asked to do (goal, " +
      "context and input), every field you can edit before it starts, how it stands, its " +
      "worker's latest status note, and its output: the result so far while it runs, or its " +
      "result once it completed. checkpoint: true means the output came from a reported " +
      "checkpoint. Its error when it failed, the question it waits on when it is " +
      "parked. current is the latest follow-up in its chain that completed, with its output: " +
      "the version that stands now; output stays the task's own. steers are the messages sent " +
      "into it, oldest first, each marked taken once its work read it. Use it to answer from what " +
      "a task found, rather than from a line about it. " +
      "Don't poll a task you filed to see it end: end your turn, and its ending wakes you.",
    inputSchema: z.object({ id: z.string() }),
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
          /** The question the task is parked on, when it is parked on one. */
          question: z.string().optional(),
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
                from: z.enum(["filer", "user"]),
                by: z.string().optional(),
                at: z.number(),
                /** True once the task's current attempt read it. */
                taken: z.boolean(),
              }),
            )
            .optional(),
        }),
      }),
      z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
    ]),
    execute: async (input, ctx) => {
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const t = collection.get(input.id);
      if (t === undefined) return taskNotFoundError(input.id);
      const taskInput = t.input === undefined ? undefined : readable(t.input);
      const output = t.output === undefined ? undefined : readable(t.output);
      const metadata = t.metadata === undefined ? undefined : readable(t.metadata);
      const current = currentFor(t, latestCompletedByRoot(collection.list()).get(t.followUpOf ?? t.id));
      const currentOutput = current?.output === undefined ? undefined : readable(current.output);
      return {
        ok: true as const,
        task: {
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
          ...(taskInput !== undefined ? { input: taskInput.value, ...(taskInput.cut ? { inputCut: true as const } : {}) } : {}),
          ...(output !== undefined ? { output: output.value, ...(output.cut ? { outputCut: true as const } : {}) } : {}),
          ...(t.checkpointed === true ? { checkpoint: true as const } : {}),
          ...(t.statusNote !== undefined ? { statusNote: t.statusNote } : {}),
          ...(t.error !== undefined ? { error: t.error } : {}),
          ...(t.parkedOnQuestion === true && t.feedback ? { question: t.feedback } : {}),
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
        },
      };
    },
  });

  const answerTask = defineTool({
    name: named("answerTask"),
    description:
      "Answer a task that is parked on its worker's question. The task goes back in the " +
      "queue with your answer, and its worker picks it up in the same session, with " +
      "everything it did before it asked. Answering does not use up the task's retries. " +
      "A task that isn't waiting on a question, or one already answered, is turned away.",
    inputSchema: z.object({ taskId: z.string(), answer: z.string() }),
    outputSchema: okOrError,
    execute: async (input, ctx) => {
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const task = collection.get(input.taskId);
      if (!task) return taskNotFoundError(input.taskId);
      const refused = notParkedOnQuestion(task);
      if (refused !== undefined) return refused;
      // The question this answer is for is the park read above, on its
      // attempt: the write is fenced by a ticket minted from that read, so an
      // answer that arrives after the task was answered, ran again and parked
      // on a newer question is refused inside the atomic write rather than
      // taken as the newer question's answer. Server-derived: the row, never
      // input. The fenced `unpark` also refuses a row that left `parked`.
      const outcome: TaskWriteOutcome | undefined = await collection.unpark(input.taskId, input.answer, {
        answer: true,
        claim: ticketForClaim(collection.collectionId, task, collection.partition),
      });
      if (outcome != null && outcome.outcome === "declined") {
        if (outcome.reason === "terminal") return declinedWriteToolError(input.taskId, outcome, STATUS_CLAUSE);
        if (outcome.status === "parked") {
          return {
            ok: false as const,
            taskId: input.taskId,
            error:
              `not_parked_on_question: task "${input.taskId}" has moved on to a newer question ` +
              `since this answer was given. Nothing was written.`,
          };
        }
        return (
          notParkedOnQuestion({ ...task, status: outcome.status }) ?? {
            ok: false as const,
            taskId: input.taskId,
            error:
              `task_write_declined: the answer to task "${input.taskId}" was refused ` +
              `(${outcome.reason}); the task is ${outcome.status}. Nothing was written.`,
          }
        );
      }
      return { ok: true as const };
    },
  });

  // The filer's four, then `answerTask` (until FIX-2058), then `dispatchTask`
  // on a board that dispatches (until FIX-2082 and FIX-2083).
  const tools = [createTask, getTask, listTasks, updateTask, answerTask];
  return dispatches ? [...tools, dispatchTask] : tools;
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
 *   once, and `resumesWaits: true` when it also has a waker, so `dispatchTask`
 *   may offer `wait` ({@link TaskToolsOptions}).
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
   * request, sent when a waited-on task ends) resumes a turn parked on a
   * wait. Only then may
   * `dispatchTask` offer `wait`, so it has no effect without `dispatches`.
   * Default `false`: a board that nothing wakes would leave every wait to its
   * timeout.
   */
  readonly resumesWaits?: boolean;
  /**
   * The board starts a ready row at once (FIX-1875): its ref's writes wake
   * whatever runs it, so `dispatchTask` is offered, and it means the work
   * starts now. Default `false`: a board a drain runs decides for itself when
   * each row runs, so a dispatch there would promise a start nothing makes.
   */
  readonly dispatches?: boolean;
  /**
   * `dispatchTask`'s post form (`post: true`), for a layer that routes posts
   * through this board. On a turn {@link DispatchPostForm.routing} answers
   * true, `dispatchTask` takes `post` and `target`, and a call with
   * `post: true` is handed to {@link DispatchPostForm.file}; on any other turn
   * neither field is in the schema, and either is refused `post_unavailable`.
   * Has no effect without `dispatches`.
   */
  readonly posts?: DispatchPostForm;
  /**
   * What a task turn that asks `dispatchTask` to wait is told to do instead,
   * in the `wait_unavailable` refusal and the tool's description: for a layer
   * that wakes a task turn's task when a task it dispatched ends. Omitted, it
   * is told to hand the task over without waiting.
   */
  readonly taskTurnInstead?: string;
}

/**
 * The post form of `dispatchTask`, supplied by the layer that knows what a post
 * is. The board files nothing for it: `file` files the row itself, through
 * the board's ref, with whatever server-written fields it needs.
 */
export interface DispatchPostForm {
  /** Whether the running turn is routing a post it can hand on. */
  routing(ctx: BlockContext): boolean;
  /** Appended to `dispatchTask`'s description on a routing turn. */
  readonly description: string;
  /**
   * Hand the post on to `assignee` (and `target`). Its answer is the tool's:
   * `ok` with the filed row's id, or a `note` saying why none was filed.
   */
  file(
    ctx: BlockContext,
    call: { assignee?: string; target?: string },
  ): Promise<{ ok: true; taskId?: string; note?: string } | { ok: false; error: string }>;
}

/**
 * The task tools as a turn gets them: a list of the same names per kind of
 * turn (waiting or not, routing a post or not), each built once, and the one
 * the turn can use. The filer's four and `answerTask`, and `dispatchTask` on a board
 * that dispatches (`options.dispatches`). `dispatchTask` carries `wait` and
 * `timeoutMs` only on a board that also resumes waits (`options.resumesWaits`)
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
    ...(options.taskTurnInstead !== undefined ? { taskTurnInstead: options.taskTurnInstead } : {}),
  };
  const posts = options.dispatches === true ? options.posts : undefined;
  // Only `dispatchTask` waits, so a board without it has no waiting list.
  const waits = options.resumesWaits === true && options.dispatches === true;
  // One list per kind of turn, built once, the first time a turn needs it.
  const lists = new Map<string, GeneratorTool[]>();
  const listFor = (wait: boolean, posting: DispatchPostForm | undefined): GeneratorTool[] => {
    const key = `${wait}:${posting !== undefined}`;
    let list = lists.get(key);
    if (list === undefined) {
      list = buildTaskTools(resolveCollection, {
        ...base,
        ...(wait ? { wait: true } : {}),
        ...(posting !== undefined ? { posting } : {}),
      });
      lists.set(key, list);
    }
    return list;
  };
  // The plain list now, so a board that can't build its tools fails at wiring.
  listFor(false, undefined);
  return (ctx) =>
    listFor(
      waits && canHoldWait(ctx as Pick<BlockContext, "requestHost">),
      posts !== undefined && posts.routing(ctx as BlockContext) ? posts : undefined,
    );
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
 * ({@link TaskToolsOptions.dispatches}), and `dispatchTask_<suffix>` is among
 * them. It never waits: an action has no turn to park.
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
