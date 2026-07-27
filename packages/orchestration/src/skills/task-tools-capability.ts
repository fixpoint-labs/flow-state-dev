/**
 * `taskTools` capability — the programmatic surface for a delegation board.
 *
 * When a skill delegates (declares `agents:`), `createSkillsLibrary` installs
 * a private task board on the executive generator's own block state and wires
 * these eight handler-shaped tools (`addTask`/`assignTask`/`completeTask`/
 * `failTask`/`blockTask`/`cancelTask`/`updateTask`/`listTasks`) so the model
 * can assign work, mark a task complete, or query the board.
 *
 * The board is a **ledger** these tools plan on — `addTask` records a row and
 * returns its id; nothing executes it by itself. The executive runs delegated
 * work by assigning tasks (`addTask` with an `assignee` naming an agent) and
 * then calling `runBoard`, the delegation surface's drain over this same ledger.
 *
 * Board resolution goes through an injectable resolver (FIX-918). The default
 * reads the host generator's own-state board via `ctx.parent` (each handler
 * runs as a child block, so `ctx.parent` — not `ctx.self`, which is the
 * per-call scope — reaches the generator's ledger). An injected resolver
 * targets a shared board instead. With no board resolvable, every tool returns
 * `{ ok: false, error: "no_delegation_board" }` rather than throwing.
 */

import { defineCapability, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  IllegalTaskTransitionError,
  isTerminalStatus,
  isTransitionAllowed,
  taskSchema,
  TaskCapExceededError,
  type Task,
  type TaskCollectionRef,
  type TaskStatus,
} from "../tasks";
// `shouldRetryOnFail` is the collection's own routing predicate for `fail()`.
// Imported from the module rather than the package barrel so the recovery
// composer stays in step with `fail()` without widening the public surface —
// same deep-import shape `task-board/capability.ts` uses for `safe-key`.
import { shouldRetryOnFail } from "../tasks/collection/internal";

/**
 * Own-state field the delegation board lives on. `createSkillsLibrary`
 * contributes `stateSchema: { [DELEGATION_BOARD_FIELD]: record<Task> }` to the
 * host generator when a bound skill delegates, and each tool declares it via
 * `parentStateSchema` so `ctx.parent` carries the state ops.
 */
export const DELEGATION_BOARD_FIELD = "delegationBoard";

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
 * are a property of the surface that BUILT the board, not of `taskTools`. The
 * delegation surface passes its own capped resolver instead of relying on this;
 * see `defaultOwnStateResolver`'s note on the `taskTools` singleton below.
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
    backing: "sequencer",
    sequencer: parent as StateRef<Record<string, unknown>>,
    stateKey: DELEGATION_BOARD_FIELD,
    collectionId: DELEGATION_BOARD_FIELD,
    ctx,
    // Ledger changes drive the client's plan UI but stay out of the LLM
    // history — the tools' return values already carry the signal. Matches
    // the runBoard drain's visibility so both paths to this board agree.
    changeVisibility: { client: true, history: false },
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
 * The declared agents a delegation board can be assigned to, plus a
 * human-readable rendering for error messages. Supplied by the delegation
 * surface so assignment is checked against the board's real participant
 * registry — the same list the executive's guidance advertises as "Your
 * agents:", so context and validation cannot disagree.
 */
export interface WorkerRoster {
  /** True when `assignee` names a declared agent on this board. */
  has(assignee: string): boolean;
  /** Roster rendered for an error message, e.g. `researcher (…), writer (…)`. */
  describe(): string;
}

const unknownAssigneeError = (assignee: string, roster: WorkerRoster) => ({
  ok: false as const,
  error:
    `unknown_assignee: "${assignee}" is not an agent on this board. ` +
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
 *   default worker (the delegation floor, FIX-940). Reaching the floor by
 *   *intent* stays open; only reaching it by *accident* (a typo) is closed.
 * - **No roster.** The standalone `taskTools` singleton, and a delegation board
 *   with no declared agents at all, supply none — there is nothing to validate
 *   against, so validation is inert and every assignee is accepted as before
 *   (BP-030: tolerate the old, roster-less shape).
 *
 * This is the one place the definition of "a valid assignee" lives. FIX-923 /
 * FIX-641 widen it here (to admit an explicit ad-hoc agent spec) rather than
 * scattering the rule across the three tools that call it.
 */
export function checkAssignee(
  assignee: string | undefined,
  roster: WorkerRoster | undefined,
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
 * `runBoard` is deliberately absent. It is not one of the eight `taskTools` —
 * the delegation surface installs it separately, and `taskTools` also ships
 * standalone — so naming it would point a directly-wired consumer at a tool it
 * does not have.
 *
 * @param task The task as it stands now, used only to route `failTask`. Absent
 *   (a task removed underneath us) is read as "no retry budget".
 */
function statusChangingTools(task: Task | undefined): Array<{ name: string; target: TaskStatus }> {
  return [
    { name: "blockTask", target: "blocked" },
    { name: "cancelTask", target: "cancelled" },
    { name: "completeTask", target: "completed" },
    // `failTask` routes on the retry budget at call time: budget left soft-fails
    // back to `pending`, otherwise it goes terminal `errored`. Asking the
    // collection's own predicate keeps this in step with `fail()` rather than
    // restating the rule here.
    {
      name: "failTask",
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
 * Turn a refused transition into the recoverable result shape the rest of this
 * surface uses, naming the task's current status and the calls actually
 * available from it.
 *
 * **The recovery list is derived from tool-reachable actions, not from
 * `allowedTransitionsFrom`.** That helper answers a question about the
 * *collection*; the model is standing at the *tool* layer. It would advertise
 * `awaiting_review` and `in_progress`, which no task tool can reach, sending the
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
const illegalTransitionToolError = (err: IllegalTaskTransitionError, task: Task | undefined) => {
  const subject = `illegal_status_transition: task "${err.taskId}" is ${err.from}`;

  // Terminal sources name no target status. That is load-bearing for `failTask`,
  // whose attempted target (`pending` on a budgeted retry) can differ from what
  // the model meant by "fail this" — all of its terminal-source rejections land
  // here, where no target is quoted, so the divergence is never rendered.
  if (isTerminalStatus(err.from)) {
    return {
      ok: false as const,
      taskId: err.taskId,
      error:
        `${subject}, which is terminal. Its status will not change again. ` +
        `Add a new task instead.`,
    };
  }

  const available = statusChangingTools(task)
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

/** Shared output shape for the six tasked-by-id mutators. */
const okOrError = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
]);

const parentStateSchema = z.object({ [DELEGATION_BOARD_FIELD]: delegationBoardSchema });

// ---------------------------------------------------------------------------
// Tool factory — closes over the resolver so a capability instance targets a
// specific board (own-state default or an injected shared board).
// ---------------------------------------------------------------------------

function buildTaskTools(resolve: TaskCollectionResolver, roster?: WorkerRoster) {
  /**
   * `assignee`, when given, is the assignee this mutation would write; it is
   * validated after the board and the task resolve, so the three tools all
   * report the same failure order: no board, then unknown task, then unknown
   * assignee. The task is left untouched on any of them.
   */
  async function withTask(
    ctx: BlockContext,
    taskId: string,
    mutator: (collection: TaskCollectionRef) => Promise<void>,
    assignee?: string,
  ): Promise<{ ok: true } | { ok: false; error: string; taskId?: string }> {
    const collection = await resolve(ctx);
    if (!collection) return noBoardError;
    if (!collection.get(taskId)) return taskNotFoundError(taskId);
    const bad = checkAssignee(assignee, roster);
    if (bad) return bad;
    try {
      await mutator(collection);
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
        return illegalTransitionToolError(err, collection.get(taskId));
      }
      throw err;
    }
    return { ok: true as const };
  }

  const addTask = handler({
    name: "addTask",
    description:
      "Add a new task to your delegation board. Returns the new task id. " +
      "assignee optionally names one of your agents; leave it unset to run the task " +
      "on a capable default worker. Set deps to task ids that must finish first, and input " +
      "to a structured payload for the worker. Execute the plan by calling runBoard once " +
      "all tasks are added. The board bounds how many tasks may wait at once and how many it " +
      "may hold in total: enqueued_task_cap_exceeded means drain with runBoard first, and " +
      "total_task_cap_exceeded is the lifetime ceiling, which draining does not reset.",
    inputSchema: z.object({
      goal: z.string(),
      assignee: z.string().optional(),
      deps: z.array(z.string()).optional(),
      priority: z.number().optional(),
      input: z
        .unknown()
        .optional()
        .describe("Structured payload handed to the worker as the task's input."),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true), taskId: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
    parentStateSchema,
    execute: async (input, ctx) => {
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
      const bad = checkAssignee(input.assignee, roster);
      if (bad) return bad;
      try {
        const task = await collection.addTask({
          goal: input.goal,
          ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
          ...(input.deps !== undefined ? { deps: input.deps } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        });
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

  const assignTask = handler({
    name: "assignTask",
    description: "Reassign an existing task to a different worker.",
    inputSchema: z.object({ taskId: z.string(), assignee: z.string() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(
        ctx,
        input.taskId,
        (c) => c.setAssignee(input.taskId, input.assignee),
        input.assignee,
      ),
  });

  const completeTask = handler({
    name: "completeTask",
    description: "Mark a task complete with its output.",
    inputSchema: z.object({ taskId: z.string(), output: z.unknown() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.complete(input.taskId, input.output)),
  });

  const failTask = handler({
    name: "failTask",
    description: "Mark a task failed with an error message.",
    inputSchema: z.object({ taskId: z.string(), error: z.string() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.fail(input.taskId, input.error)),
  });

  const blockTask = handler({
    name: "blockTask",
    description: "Block a task pending an external condition.",
    inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.block(input.taskId, input.reason)),
  });

  const cancelTask = handler({
    name: "cancelTask",
    description: "Cancel a task (terminal). Use when the work is no longer needed.",
    inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.cancel(input.taskId, input.reason)),
  });

  const updateTask = handler({
    name: "updateTask",
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
          if (patch.priority !== undefined) await c.setPriority(input.taskId, patch.priority);
          if (patch.assignee !== undefined) await c.setAssignee(input.taskId, patch.assignee);
          if (patch.metadata !== undefined) await c.patchMetadata(input.taskId, patch.metadata);
          if (patch.addLabel !== undefined) await c.addLabel(input.taskId, patch.addLabel);
          if (patch.removeLabel !== undefined) await c.removeLabel(input.taskId, patch.removeLabel);
        },
        // A patch that doesn't touch `assignee` leaves this undefined, so the
        // gate stays inert for a priority/label-only update.
        input.patch.assignee,
      ),
  });

  const listTasks = handler({
    name: "listTasks",
    description:
      "List tasks on your delegation board, optionally filtered by status or assignee.",
    inputSchema: z.object({
      status: z
        .enum(["pending", "in_progress", "awaiting_review", "completed", "errored", "cancelled", "blocked"])
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
 * @param roster Optional declared-agent roster. Supply it and `addTask`/
 *   `assignTask`/`updateTask` reject an assignee that names no declared agent.
 *   Omit it and assignment is unvalidated, as before.
 */
export function buildTaskToolsList(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
  roster?: WorkerRoster,
) {
  return buildTaskTools(resolveCollection, roster);
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
 *   shared board for the shared-board delegation case (or a drain board for a
 *   Shape 2 fan-out worker).
 * @param roster Optional declared-agent roster for assignee validation. Supply
 *   it so a fan-out worker enqueuing follow-up tasks mid-drain is held to the
 *   same roster the executive is.
 */
export function createTaskToolsCapability(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
  roster?: WorkerRoster,
): DefinedCapability {
  return defineCapability({
    name: "taskTools",
    presets: {
      tools: {
        tools: buildTaskTools(resolveCollection, roster),
      },
      default: ["tools"],
    },
  });
}

/**
 * Default instance for direct `uses: [taskTools]` wiring (own-state board).
 *
 * **This instance is UNCAPPED** (FIX-931). It closes over
 * `defaultOwnStateResolver`, which builds a bare collection with no creation
 * caps, so a board reached this way has no `maxEnqueuedTasks` /
 * `maxTotalTasks` ceiling. Boards installed by the skills library's delegation
 * surface ARE capped (500/100 by default) — the caps come from the site that
 * constructs the collection, and wiring this capability by hand has no such
 * site. If you want a bounded board here, build the collection yourself with
 * `getOrCreateTaskCollection({ …, maxTotalTasks, maxEnqueuedTasks })` and pass a
 * resolver for it to `createTaskToolsCapability`.
 */
export const taskTools = createTaskToolsCapability();
