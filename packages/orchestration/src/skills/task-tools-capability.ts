/**
 * `taskTools` capability — the model's surface onto a task board.
 *
 * Eight handler-shaped tools (`addTask`/`assignTask`/`completeTask`/
 * `failTask`/`blockTask`/`cancelTask`/`updateTask`/`listTasks`) let a model
 * assign work, mark a task complete, or query the board.
 *
 * The board is a **ledger** these tools plan on — `addTask` records a row and
 * returns its id; nothing executes it by itself. Whatever drains that board
 * (a `taskBoard()` drain, a hand-off) runs the work.
 *
 * Board resolution goes through an injectable resolver (FIX-918). The default
 * reads the host generator's own-state board via `ctx.parent` (each handler
 * runs as a child block, so `ctx.parent` — not `ctx.self`, which is the
 * per-call scope — reaches the generator's ledger). An injected resolver
 * targets a shared board instead. With no board resolvable, every tool returns
 * `{ ok: false, error: "no_delegation_board" }` rather than throwing.
 *
 * ## Ownership (FIX-981)
 *
 * The four status-changing tools present the caller's claim ticket, read from
 * the board's per-worker seam. A worker holding task "a" that calls
 * `completeTask({ taskId: "b" })` is refused, and told which task it holds. The
 * model never sees a token: it names a task id, and that id is the target of
 * the check rather than the authority for it.
 *
 * **A call with no ticket is unguarded, and that is the contract rather than a
 * gap.** The seam has exactly one stamp site — the board's worker body — so
 * "no ticket presented" and "not a claimed worker" are the same condition and
 * cannot drift apart. A coordinator settling a task it never claimed is not a
 * stale owner and is not guarded; failing closed there would break the shipped
 * default `taskTools` instance, which a coordinator holds against its own board
 * with no claim of any kind.
 *
 * `assignTask` and `updateTask` present nothing, deliberately: they travel the
 * patch path, not the transition path, and a live block relabelling tasks it
 * does not hold is a supported thing to do.
 *
 * ## Waiting for the answer (FIX-1816)
 *
 * On a turn whose host can hold an ask (durable execution, and a durability
 * sweeper that times asks out: `RequestHost.hasAskSweeper`), the capability's
 * `addTask` takes two more flat fields: `waitForResponse`, which files the task
 * and parks the turn until it ends, returning its output as `answer`; and
 * `timeoutMs`, the ask's bound. Anywhere else the fields are not in the schema
 * and `addTask` is exactly as before. It adds no tool. The `addTask_<board>`
 * action never waits.
 */

import { defineCapability, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { ActionConfig, BlockContext, StateRef } from "@flow-state-dev/core/types";
import type { GeneratorTool } from "@flow-state-dev/core";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  IllegalTaskTransitionError,
  isTerminalStatus,
  isTransitionAllowed,
  taskSchema,
  TaskCapExceededError,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskStatus,
  type TaskTransitionOptions,
  type TaskWriteOutcome,
} from "../tasks";
// The board's per-worker claim seam. A deep import for the same reason
// `shouldRetryOnFail` is one: this surface consumes the seam, it does not widen
// the task-board's public API to advertise it.
import { currentWorkerClaim } from "../task-board/flow-policy-wiring";
// The resolver `taskBoard()` recorded for its handle, read without importing
// the task-board barrel (which imports this module's neighbours).
import { boardResolverOf } from "../task-board/board-resolver";
// `shouldRetryOnFail` is the collection's own routing predicate for `fail()`.
// Imported from the module rather than the package barrel so the recovery
// composer stays in step with `fail()` without widening the public surface —
// same deep-import shape `task-board/capability.ts` uses for `safe-key`.
import { shouldRetryOnFail } from "../tasks/collection/internal";
import { addTaskAndWait, canHoldAsk, MAX_ASK_TIMEOUT_MS, MIN_ASK_TIMEOUT_MS } from "../tasks/helpers/wait-for-response";

/**
 * Own-state field the default resolver's board lives on. A host generator that
 * wants an own-state board declares
 * `stateSchema: { [DELEGATION_BOARD_FIELD]: delegationBoardSchema }`, and each
 * tool declares it via `parentStateSchema` so `ctx.parent` carries the state
 * ops.
 */
export const DELEGATION_BOARD_FIELD = "delegationBoard";

/**
 * Change-stream visibility for the own-state board. The `task-change` items
 * drive the client's live plan UI but never re-enter the executive's LLM
 * history — the task tools' return values already carry that signal.
 */
const DELEGATION_BOARD_VISIBILITY = { client: true, history: false } as const;

/**
 * Schema for the delegation board field (a `Record<taskId, Task>`). Defaults to
 * `{}` so the engine's empty-parse own-state seeding (`stateSchema.safeParse({})`)
 * creates the board — without the default the host state initializes to `{}`,
 * the field is absent, and the first task tool call reports `no_delegation_board`.
 */
export const delegationBoardSchema = z.record(z.string(), taskSchema).default({});

/** Resolves the live TaskCollection a `taskTools` handler mutates. */
export type TaskCollectionResolver = (
  ctx: BlockContext,
) => Promise<TaskCollectionRef | undefined>;

// ---------------------------------------------------------------------------
// Default resolver — the host generator's own-state board via `ctx.parent`
// ---------------------------------------------------------------------------

/**
 * Read the host generator's delegation board from `ctx.parent`. Returns
 * `undefined` (→ `no_delegation_board`) when the parent declares no own state
 * or no board field, so a stray `taskTools`-only consumer degrades gracefully.
 *
 * NOT capped (FIX-931). This builds a bare collection with no creation caps, so
 * a board reached only through this fallback is unbounded. That is deliberate —
 * it has no construction site to take cap options from — but it means the caps
 * are a property of the surface that BUILT the board, not of `taskTools`. A
 * caller that wants a bounded board passes its own capped resolver instead; see
 * the note on the `taskTools` singleton below.
 */
export const defaultOwnStateResolver: TaskCollectionResolver = async (ctx) => {
  const parent = (
    ctx as {
      parent?: Partial<StateRef<Record<string, unknown>>>;
    }
  ).parent;
  if (!parent || typeof parent.atomicState !== "function") return undefined;
  const state = parent.state;
  if (state === null || typeof state !== "object") return undefined;
  if (!(DELEGATION_BOARD_FIELD in state)) return undefined;
  return getOrCreateTaskCollection({
    backing: "state",
    state: parent as StateRef<Record<string, unknown>>,
    stateKey: DELEGATION_BOARD_FIELD,
    collectionId: DELEGATION_BOARD_FIELD,
    ctx,
    changeVisibility: DELEGATION_BOARD_VISIBILITY,
  });
};

// ---------------------------------------------------------------------------
// Shared error contract
// ---------------------------------------------------------------------------

const noBoardError = { ok: false as const, error: "no_delegation_board" };
const taskNotFoundError = (id: string) => ({ ok: false as const, error: "task_not_found", taskId: id });

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
 * - **No roster.** The standalone `taskTools` singleton, and any caller that
 *   passes none, supply none — there is nothing to validate against, so
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

/** Map a creation-cap breach (FIX-931) onto its distinct soft-error code. */
const capError = (err: TaskCapExceededError) => ({
  ok: false as const,
  error:
    err.cap === "enqueued"
      ? ("enqueued_task_cap_exceeded" as const)
      : ("total_task_cap_exceeded" as const),
});

// ---------------------------------------------------------------------------
// Illegal status transitions (FIX-950)
// ---------------------------------------------------------------------------

/**
 * The status-changing tools on THIS surface, paired with the status each moves a
 * task to, in the order an error message lists them.
 *
 * @param task The task as it stands now, used only to route `failTask`. Absent
 *   (a task removed underneath us) is read as "no retry budget".
 */
function statusChangingTools(
  task: Task | undefined,
  suffix = ""
): Array<{ name: string; target: TaskStatus }> {
  const named = (base: string): string => `${base}${suffix}`;
  return [
    { name: named("blockTask"), target: "blocked" },
    { name: named("cancelTask"), target: "cancelled" },
    { name: named("completeTask"), target: "completed" },
    // `failTask` routes on the retry budget at call time: budget left soft-fails
    // back to `pending`, otherwise it goes terminal `errored`. Asking the
    // collection's own predicate keeps this in step with `fail()` rather than
    // restating the rule here.
    {
      name: named("failTask"),
      target: task !== undefined && shouldRetryOnFail(task) ? "pending" : "errored",
    },
  ];
}

/** Render tool names as `a`, `a or b`, `a, b, or c`. */
function listCalls(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

/**
 * The one renderer for "this task is finished, so your write was refused"
 * (FIX-976, Decision 6).
 *
 * Four tools now report this — `blockTask` and `completeTask`/`failTask` via a
 * refused transition, `assignTask`/`cancelTask`/`updateTask` via a declined
 * write — and they must not drift into four ways of saying the same thing. One
 * sentence shape, one `snake_case` prefix convention (the one
 * `task_not_found` / `unknown_assignee` already use), and exactly one clause
 * that varies: **what would not change**.
 *
 * That clause has to vary, which is why this is parameterized rather than
 * reused verbatim. `assignTask` attempts no status transition, so telling it
 * "its status will not change again" would name the wrong thing and
 * `illegal_status_transition:` would be the wrong code.
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
/** The `clause` for a write that would have changed who the task is assigned to. */
const ASSIGNEE_CLAUSE = "Its assignee will not change.";

/**
 * Turn a refused transition into the recoverable result shape the rest of this
 * surface uses, naming the task's current status and the calls actually
 * available from it.
 *
 * **The recovery list is derived from tool-reachable actions, not from
 * `allowedTransitionsFrom`.** That helper answers a question about the
 * *collection*; the model is standing at the *tool* layer. It would advertise
 * `parked` and `in_progress`, which no task tool can reach, sending the
 * model at operations it cannot perform. Here each tool's own target is tested
 * instead.
 *
 * **No separate "exclude the rejected tool" step is needed.** The rejected
 * target is by definition not allowed from this status, so the
 * `isTransitionAllowed` test already drops any tool aiming there. That is also
 * why this needs no knowledge of which tool it serves — `withTask` receives an
 * opaque mutator and never learns.
 *
 * **There is no same-status filter, deliberately.** The rule is "would this call
 * succeed", not "does it change the status". A budgeted `failTask` on a
 * `pending` task targets `pending` yet still writes `feedback`, clears
 * `error`/`leaseUntil`, and emits a `retried` change; `blockTask` on an
 * already-`blocked` task updates the reason. Both are real work and stay listed.
 *
 * A non-terminal source always yields at least `cancelTask` (every non-terminal
 * status permits `cancelled`), so the action list is never empty — terminal
 * sources take the other branch rather than rendering an empty list.
 */
const illegalTransitionToolError = (
  err: IllegalTaskTransitionError,
  task: Task | undefined,
  /** Board qualifier, so the tools this names are the ones the caller holds. */
  nameSuffixForGuidance = ""
) => {
  const subject = `illegal_status_transition: task "${err.taskId}" is ${err.from}`;

  // Terminal sources name no target status. That is load-bearing for `failTask`,
  // whose attempted target (`pending` on a budgeted retry) can differ from what
  // the model meant by "fail this" — all of its terminal-source rejections land
  // here, where no target is quoted, so the divergence is never rendered.
  if (isTerminalStatus(err.from)) {
    return terminalWriteToolError({
      code: "illegal_status_transition",
      taskId: err.taskId,
      status: err.from,
      clause: STATUS_CLAUSE,
    });
  }

  const available = statusChangingTools(task, nameSuffixForGuidance)
    .filter((t) => isTransitionAllowed(err.from, t.target))
    .map((t) => t.name);

  // Said without asserting how a task gets started — this surface does not know
  // whether its consumer has a drain tool.
  const because = err.from === "pending" ? " — a pending task has not been started yet" : "";

  return {
    ok: false as const,
    taskId: err.taskId,
    error:
      `${subject}, so transitioning to ${err.to} is not available${because}. ` +
      `From here you can call ${listCalls(available)}.`,
  };
};

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
  if (declined.reason === "not-my-task" && heldTaskId !== undefined) {
    return {
      ok: false as const,
      taskId,
      error:
        `task_write_declined: you hold task "${heldTaskId}", not "${taskId}". ` +
        `You can only settle the task you are working on — call this on ` +
        `"${heldTaskId}" instead.`,
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

/** Shared output shape for the six tasked-by-id mutators. */
const okOrError = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
]);

const parentStateSchema = z.object({ [DELEGATION_BOARD_FIELD]: delegationBoardSchema });

/**
 * The options a status-changing tool passes to the substrate (FIX-981).
 *
 * `undefined` when the caller holds no claim, rather than `{ claim: undefined }`
 * — so a coordinator context calls the collection with exactly the arguments it
 * called with before this change, and "unguarded behaves byte for byte as
 * today" is a property of the call, not of the guard's tolerance for an empty
 * options object.
 *
 * `ifAllowed` is deliberately NOT set. These tools rely on
 * `IllegalTaskTransitionError` propagating so `illegalTransitionToolError` can
 * tell the model which calls are available from the task's current status;
 * declining silently instead would trade that for a worse message.
 */
const claimGuard = (
  claim: TaskClaimTicket | undefined,
): TaskTransitionOptions | undefined => (claim === undefined ? undefined : { claim });

// ---------------------------------------------------------------------------
// Tool factory — closes over the resolver so a capability instance targets a
// specific board (own-state default or an injected shared board).
// ---------------------------------------------------------------------------

function buildTaskTools(
  resolve: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  nameSuffix?: string,
  /**
   * Capabilities each tool composes. Only {@link taskToolActions} passes one: a
   * board's own capability, so the ledger's resource is installed on the
   * action's block rather than left for the flow to declare.
   */
  uses?: readonly DefinedCapability[],
  /**
   * Present no worker claim, whatever async scope the tool runs in. Only
   * {@link taskToolActions} sets it: an action is a caller's move (BR-25), and
   * a worker that dispatches one in-process must not lend it the worker's
   * ticket through the claim seam.
   */
  claimless = false,
  /**
   * Offer `addTask`'s `waitForResponse` and `timeoutMs`. Only the capability's
   * per-turn tool list sets it, on a host that can hold an ask
   * ({@link canHoldAsk}).
   */
  wait = false,
) {
  const defineTool = uses === undefined ? handler : handler.withDefaults({ uses: [...uses] });
  /**
   * The eight names, optionally board-qualified.
   *
   * A generator asserts its tool names are unique, and these eight are fixed
   * strings, so composing two boards' capabilities into one block collides on
   * every one of them. A suffix is what makes a second board addressable at
   * all; without one the surface is single-board by construction.
   */
  const named = (base: string): string =>
    nameSuffix === undefined ? base : `${base}_${nameSuffix}`;
  const nameSuffixForGuidance = nameSuffix === undefined ? "" : `_${nameSuffix}`;
  /**
   * `options.assignee`, when given, is the assignee this mutation would write;
   * it is validated after the board and the task resolve, so the three tools all
   * report the same failure order: no board, then unknown task, then unknown
   * assignee. The task is left untouched on any of them.
   *
   * The mutator **carries the substrate's verdict out** (FIX-976). Its declared
   * return is `TaskWriteOutcome | void`, not `unknown`: widening it to `unknown`
   * would silence the type errors while throwing the verdict away, which is the
   * bug this change exists to fix. `void` stays in the union for `updateTask`,
   * whose composed mutator returns nothing on the paths that cannot decline.
   *
   * `options.declineClause` is what the attempted write would not have changed,
   * for a tool whose write can decline (`assignTask`, `cancelTask`,
   * `updateTask`). It defaults to the status clause, which is right for every
   * transition-shaped write on this surface.
   *
   * **The claim ticket is read here, never from the model** (FIX-981). The
   * mutator receives whatever the caller's worker scope holds — `undefined`
   * outside one — and forwards it to the collection, so the ownership question
   * is answered at the substrate's one guard rather than re-asked per tool. The
   * model's input is unchanged: it names a task id, and that id is the *target*
   * of the check, never the authority for it (BP-031).
   */
  async function withTask(
    ctx: BlockContext,
    taskId: string,
    mutator: (
      collection: TaskCollectionRef,
      claim: TaskClaimTicket | undefined,
    ) => Promise<TaskWriteOutcome | void>,
    options?: { assignee?: string; declineClause?: string },
  ): Promise<{ ok: true } | { ok: false; error: string; taskId?: string }> {
    const collection = await resolve(ctx);
    if (!collection) return noBoardError;
    if (!collection.get(taskId)) return taskNotFoundError(taskId);
    // Read only when there is an assignee to check: a status change or a
    // label write asks nothing of the roster, so a per-call roster is not
    // read for it.
    const bad =
      options?.assignee === undefined
        ? undefined
        : checkAssignee(options.assignee, await rosterFor(roster, ctx));
    if (bad) return bad;
    // Read once, so the ticket the write presented is the ticket the refusal is
    // rendered against even if the scope somehow changed mid-call.
    const claim = claimless ? undefined : currentWorkerClaim();
    try {
      // Typed as nullable at this boundary on purpose (BP-030): a custom
      // `TaskCollectionRef` written before the widening — or one reached through
      // a cast — returns nothing, and `== null` carries that past rather than
      // reading silence as a decline.
      const outcome: TaskWriteOutcome | undefined | void = await mutator(collection, claim);
      if (outcome != null && outcome.outcome === "declined") {
        return declinedWriteToolError(
          taskId,
          outcome,
          options?.declineClause ?? STATUS_CLAUSE,
          claim?.taskId,
        );
      }
    } catch (err) {
      // A refused status change is a recoverable mistake the model can act on,
      // so it becomes the same `{ ok: false, error }` result the rest of this
      // surface returns (FIX-950). The catch is by TYPE and the soft set is
      // exactly this one class: a blanket `catch (err)` would also swallow CAS
      // conflicts, scope-mutation timeouts, storage failures, and ordinary bugs
      // into a polite result the model reads as its own mistake and narrates
      // past. Everything else still propagates.
      //
      // Read the task after the failure so `failTask`'s retry budget is as
      // fresh as possible; the status itself comes from the error, which the
      // guard captured inside the CAS write.
      if (err instanceof IllegalTaskTransitionError) {
        // Keyed off `err.taskId`, not the closure's `taskId`: everything else in
        // the composer reads the error, and the two are only incidentally equal
        // (no mutator transitions a task other than the one it was handed).
        return illegalTransitionToolError(err, collection.get(err.taskId), nameSuffixForGuidance);
      }
      throw err;
    }
    // Read this precisely: `ok: true` means **the backing reported no decline**,
    // not "the write happened" (FIX-976). For the two built-in backings those
    // coincide. A custom ref that determines nothing still lands here, and the
    // framework will not synthesize a verdict it was not given — inferring one by
    // re-reading task state would be the check-after-write race the guards were
    // moved inside the atomic write to avoid.
    return { ok: true as const };
  }

  const addTaskDescription =
    "Add a new task to your delegation board. Returns the new task id. " +
    "assignee optionally names one of your agents or tools; leave it unset to run the task " +
    "on a capable default worker. Set deps to task ids that must finish first, and input " +
    "to a structured payload for the worker — when the assignee is a tool that payload is " +
    "the tool's own arguments, and it is all the tool receives (deps order it, but it " +
    "cannot read an upstream task's result). This records the task on the board; it does " +
    "not run it. The board may bound how many tasks wait at once and how many it may hold " +
    "in total: enqueued_task_cap_exceeded means too many tasks are already waiting to run, " +
    "and total_task_cap_exceeded is the lifetime ceiling, which draining does not reset.";
  const waitDescription =
    " Set waitForResponse to true when your next step needs the task's result: the task is " +
    "filed as usual, then you wait until it ends and get its output back as answer. Only one " +
    "waiting addTask per step. timeoutMs bounds the wait, from 30000 (30 seconds) to 3600000 " +
    "(an hour), five minutes when unset, and is only valid with waitForResponse. Errors: " +
    "wait_timed_out (it didn't end in time; it is cancelled), wait_task_failed, " +
    "wait_task_cancelled, wait_already_pending, wait_unavailable (you are working a task " +
    "yourself, so you can't wait), wait_timeout_out_of_range.";
  const addTaskFields = {
    goal: z.string(),
    assignee: z.string().optional(),
    deps: z.array(z.string()).optional(),
    priority: z.number().optional(),
    input: z
      .unknown()
      .optional()
      .describe("Structured payload handed to the worker as the task's input."),
    metadata: z.record(z.string(), z.unknown()).optional(),
  };
  const waitFields = {
    waitForResponse: z
      .boolean()
      .optional()
      .describe("Wait for the task to end and return its output as answer."),
    timeoutMs: z
      .number()
      .optional()
      .describe(
        `How long to wait, in ms: ${MIN_ASK_TIMEOUT_MS} to ${MAX_ASK_TIMEOUT_MS}. Five minutes when unset. Only with waitForResponse.`,
      ),
  };
  type AddTaskInput = z.infer<z.ZodObject<typeof addTaskFields>> & {
    waitForResponse?: boolean;
    timeoutMs?: number;
  };

  const addTask = defineTool({
    name: named("addTask"),
    description: wait ? addTaskDescription + waitDescription : addTaskDescription,
    inputSchema: wait ? z.object({ ...addTaskFields, ...waitFields }) : z.object(addTaskFields),
    outputSchema: wait
      ? z.union([
          z.object({ ok: z.literal(true), taskId: z.string(), answer: z.unknown().optional() }),
          z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
        ])
      : z.union([
          z.object({ ok: z.literal(true), taskId: z.string() }),
          z.object({ ok: z.literal(false), error: z.string() }),
        ]),
    parentStateSchema,
    execute: async (raw, ctx) => {
      const input = raw as AddTaskInput;
      // A bound with nothing to bound is refused, never ignored: a filer who
      // meant to wait learns it didn't.
      if (input.timeoutMs !== undefined && input.waitForResponse !== true) {
        return {
          ok: false as const,
          error:
            "wait_timeout_without_wait: timeoutMs bounds a wait, and this call doesn't wait. " +
            "Set waitForResponse: true, or drop timeoutMs. Nothing was filed.",
        };
      }
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      // Failure order is deliberate and uniform across the tools that touch an
      // assignee: no board (above) -> unknown assignee -> creation cap.
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
        input.assignee === undefined
          ? undefined
          : checkAssignee(input.assignee, await rosterFor(roster, ctx));
      if (bad) return bad;
      const init = {
        goal: input.goal,
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.deps !== undefined ? { deps: input.deps } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      };
      try {
        if (input.waitForResponse === true) {
          const result = await addTaskAndWait(ctx, collection, init, {
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          });
          if (result.ok) return { ok: true as const, taskId: result.taskId, answer: result.answer };
          return {
            ok: false as const,
            error: result.message === undefined ? result.error : `${result.error}: ${result.message}`,
            ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
          };
        }
        const task = await collection.addTask(init);
        return { ok: true as const, taskId: task.id };
      } catch (err) {
        // A creation cap (FIX-931) is a soft error the model can act on — drain
        // to free enqueue slots, or stop planning at the lifetime ceiling. Every
        // other throw still propagates.
        if (err instanceof TaskCapExceededError) return capError(err);
        throw err;
      }
    },
  });

  const assignTask = defineTool({
    name: named("assignTask"),
    description:
      "Reassign an existing task to a different worker. A task that has already " +
      "finished cannot be reassigned — you get told so rather than a silent success.",
    inputSchema: z.object({ taskId: z.string(), assignee: z.string() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.setAssignee(input.taskId, input.assignee), {
        assignee: input.assignee,
        declineClause: ASSIGNEE_CLAUSE,
      }),
  });

  const completeTask = defineTool({
    name: named("completeTask"),
    description: "Mark a task complete with its output.",
    inputSchema: z.object({ taskId: z.string(), output: z.unknown() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c, claim) =>
        c.complete(input.taskId, input.output, claimGuard(claim)),
      ),
  });

  const failTask = defineTool({
    name: named("failTask"),
    description: "Mark a task failed with an error message.",
    inputSchema: z.object({ taskId: z.string(), error: z.string() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c, claim) =>
        c.fail(input.taskId, input.error, claimGuard(claim)),
      ),
  });

  const blockTask = defineTool({
    name: named("blockTask"),
    description: "Block a task pending an external condition.",
    inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c, claim) =>
        c.block(input.taskId, input.reason, claimGuard(claim)),
      ),
  });

  const cancelTask = defineTool({
    name: named("cancelTask"),
    description:
      "Cancel a task (terminal). Use when the work is no longer needed. A task that " +
      "has already finished cannot be cancelled — you get told so rather than a " +
      "silent success.",
    inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c, claim) =>
        c.cancel(input.taskId, input.reason, claimGuard(claim)),
      ),
  });

  const updateTask = defineTool({
    name: named("updateTask"),
    description:
      "Patch a task's mutable fields (priority, metadata, assignee, labels). All patch fields are optional.",
    inputSchema: z.object({
      taskId: z.string(),
      patch: z.object({
        priority: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        assignee: z.string().optional(),
        addLabel: z.string().optional(),
        removeLabel: z.string().optional(),
      }),
    }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(
        ctx,
        input.taskId,
        async (c) => {
          const { patch } = input;
          // The assignee write runs FIRST and short-circuits (FIX-976, Decision
          // 4). Under the assignment-only guard exactly one of these five writes
          // can decline, so ordering it first makes a single verdict honest in
          // both directions: a decline means nothing has run and nothing was
          // mutated. If it succeeds, the remaining four are unguarded by design
          // and land correctly even if the task settles underneath them — which
          // is precisely what should happen to a label or priority write.
          //
          // Nullable on purpose: a pre-widening custom ref returns nothing, and
          // that is carried past rather than read as a decline (BP-030).
          if (patch.assignee !== undefined) {
            const outcome: TaskWriteOutcome | undefined = await c.setAssignee(
              input.taskId,
              patch.assignee,
            );
            if (outcome != null && outcome.outcome === "declined") return outcome;
          }
          if (patch.priority !== undefined) await c.setPriority(input.taskId, patch.priority);
          if (patch.metadata !== undefined) await c.patchMetadata(input.taskId, patch.metadata);
          if (patch.addLabel !== undefined) await c.addLabel(input.taskId, patch.addLabel);
          if (patch.removeLabel !== undefined) await c.removeLabel(input.taskId, patch.removeLabel);
        },
        {
          // A patch that doesn't touch `assignee` leaves this undefined, so the
          // gate stays inert for a priority/label-only update.
          assignee: input.patch.assignee,
          // Only the assignee write can decline here, so the clause names it.
          declineClause: ASSIGNEE_CLAUSE,
        },
      ),
  });

  const listTasks = defineTool({
    name: named("listTasks"),
    description:
      "List tasks on your delegation board, optionally filtered by status or assignee.",
    inputSchema: z.object({
      status: z
        .enum(["pending", "in_progress", "parked", "completed", "errored", "cancelled", "blocked"])
        .optional(),
      assignee: z.string().optional(),
    }),
    outputSchema: z.union([
      z.object({
        ok: z.literal(true),
        tasks: z.array(
          z.object({
            id: z.string(),
            goal: z.string(),
            status: z.string(),
            assignee: z.string().optional(),
            attempts: z.number(),
            /** A turn is waiting on this task's answer (`addTask` with `waitForResponse`). */
            asked: z.literal(true).optional(),
          }),
        ),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    parentStateSchema,
    execute: async (input, ctx) => {
      const collection = await resolve(ctx);
      if (!collection) return noBoardError;
      const filter = {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      };
      const tasks = collection.list(Object.keys(filter).length > 0 ? filter : undefined);
      return {
        ok: true as const,
        tasks: tasks.map((t) => ({
          id: t.id,
          goal: t.goal,
          status: t.status,
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
          attempts: t.attempts,
          ...(t.ask != null ? { asked: true as const } : {}),
        })),
      };
    },
  });

  return [addTask, assignTask, completeTask, failTask, blockTask, cancelTask, updateTask, listTasks];
}

/**
 * Build the eight `taskTools` handler tools directly (for pushing into a
 * generator's `tools:` array rather than composing the capability via `uses:`).
 * Defaults to the own-state board resolver.
 *
 * @param roster Optional roster of the board's workers, fixed or read per call
 *   from the running context ({@link AssigneeRosterSource}). Supply it and
 *   `addTask`/`assignTask`/`updateTask` reject an assignee it does not name.
 *   Omit it and assignment is unvalidated, as before.
 */
export function buildTaskToolsList(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
  roster?: AssigneeRosterSource,
  nameSuffix?: string,
) {
  return buildTaskTools(resolveCollection, roster, nameSuffix);
}

// ---------------------------------------------------------------------------
// Capability factory
// ---------------------------------------------------------------------------

/**
 * Build the `taskTools` capability. Eight tools registered under one capability
 * so consumers wire it via `uses: [taskTools]`.
 *
 * @param resolveCollection Optional board resolver. Defaults to the host
 *   generator's own-state board via `ctx.parent`. Pass a resolver targeting a
 *   shared board instead (or a drain board for a fan-out worker).
 * @param roster Optional roster for assignee validation, fixed or read per call
 *   from the running context ({@link AssigneeRosterSource}). Supply it so a
 *   fan-out worker enqueuing follow-up tasks mid-drain is held to the same
 *   roster the executive is.
 * @param options `resumesAsks: true` when the board has a waker, so `addTask`
 *   may offer `waitForResponse` ({@link TaskToolsOptions}).
 */
export function createTaskToolsCapability(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
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

/** How a board's task tools are offered. */
export interface TaskToolsOptions {
  /**
   * The board has a waker: whatever runs it calls `resumeOwedAsks` when it
   * touches the board outside a turn (a board run, a task's notice), so a
   * turn parked on an ask is resumed when its task ends. Only then may
   * `addTask` offer `waitForResponse`. Default `false`: a board that nothing
   * wakes would leave every ask to its timeout.
   */
  readonly resumesAsks?: boolean;
}

/**
 * The eight task tools as a turn gets them: two lists of the same eight
 * names, built once, and the one the turn can use. `addTask` carries
 * `waitForResponse` and `timeoutMs` only on a board that resumes asks
 * (`options.resumesAsks`) and a host that can hold and bound one
 * ({@link canHoldAsk}); anywhere else the list is {@link buildTaskToolsList}'s.
 *
 * For a composing layer that builds its own capability over a board (pass
 * the result as a preset's `controlTools`, or call it from one).
 */
export function taskToolsForTurn(
  resolveCollection: TaskCollectionResolver,
  roster?: AssigneeRosterSource,
  options: TaskToolsOptions = {},
): (ctx: object) => GeneratorTool[] {
  const plain = buildTaskTools(resolveCollection, roster);
  if (options.resumesAsks !== true) return () => plain;
  const waiting = buildTaskTools(resolveCollection, roster, undefined, undefined, false, true);
  return (ctx) => (canHoldAsk(ctx as Pick<BlockContext, "requestHost">) ? waiting : plain);
}

/**
 * Default instance for direct `uses: [taskTools]` wiring (own-state board).
 *
 * **This instance is UNCAPPED** (FIX-931). It closes over
 * `defaultOwnStateResolver`, which builds a bare collection with no creation
 * caps, so a board reached this way has no `maxEnqueuedTasks` /
 * `maxTotalTasks` ceiling. The caps come from the site that constructs the
 * collection, and wiring this capability by hand has no such site. If you want a bounded board here, build the collection yourself with
 * `getOrCreateTaskCollection({ …, maxTotalTasks, maxEnqueuedTasks })` and pass a
 * resolver for it to `createTaskToolsCapability`.
 */
export const taskTools = createTaskToolsCapability();

// ---------------------------------------------------------------------------
// The eight tools as flow actions
// ---------------------------------------------------------------------------

/**
 * The qualifier that makes one board's eight task tools distinct from
 * another's: the board's collection id with every character a provider does
 * not allow in a tool name (`[a-zA-Z0-9_-]`) turned into `_`. So
 * `eng.feature.work`'s tools are `cancelTask_eng_feature_work`.
 *
 * **Pinned.** It is the name a model is told about on a mailbox board and the
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
 * A durable board's eight task tools as a flow `actions` map, named
 * `<tool>_<suffix>` ({@link taskToolSuffix}). Spread it into `defineFlow`'s
 * `actions` to let a caller — a person in the DevTool, an app's own screen —
 * change a task from outside the run that works it.
 *
 * Each action runs the same guarded verb a model's tool does, so a move the
 * task cannot make comes back as `{ ok: false, error }` and writes nothing.
 * None of them claims or drains the board. An action holds no claim, so it
 * settles as a coordinator does: a legal transition lands even on a row a
 * worker holds, and that worker's own later result is declined.
 *
 * Two forms:
 *
 * - `taskToolActions(board, roster?)` — a `taskBoard()` handle. Its rows are
 *   reached through the board's own resolver, and each action composes the
 *   board's capability, so the flow need not declare the collection again.
 * - `taskToolActions(collectionId, resolve, roster?)` — for a caller that
 *   resolves a durable ledger itself (a Workforce mailbox does, to fence each
 *   action to its own session).
 *
 * Pass a `roster` and the actions check assignees the way the model's tools
 * do: `addTask`, `assignTask` and `updateTask` refuse one the roster does not
 * name, with the same `unknown_assignee` answer, and write nothing. It may be a
 * function of the running context, read per call ({@link AssigneeRosterSource}),
 * for a board whose team changes while it is in use. Without one, any assignee
 * is accepted, as before.
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
): Record<string, ActionConfig>;
export function taskToolActions(
  boardOrId: TaskToolActionsBoard | string,
  resolveOrRoster?: TaskCollectionResolver | AssigneeRosterSource,
  rosterForId?: AssigneeRosterSource,
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
    buildTaskTools(resolve, roster, taskToolSuffix(collectionId), uses, true).map((tool) => [
      tool.name,
      { block: tool, description: tool.description },
    ]),
  );
}
