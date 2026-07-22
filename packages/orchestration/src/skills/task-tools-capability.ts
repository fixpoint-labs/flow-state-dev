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
  taskSchema,
  type TaskCollectionRef,
} from "../tasks";

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

function buildTaskTools(resolve: TaskCollectionResolver) {
  async function withTask(
    ctx: BlockContext,
    taskId: string,
    mutator: (collection: TaskCollectionRef) => Promise<void>,
  ): Promise<{ ok: true } | { ok: false; error: string; taskId?: string }> {
    const collection = await resolve(ctx);
    if (!collection) return noBoardError;
    if (!collection.get(taskId)) return taskNotFoundError(taskId);
    await mutator(collection);
    return { ok: true as const };
  }

  const addTask = handler({
    name: "addTask",
    description:
      "Add a new task to your delegation board. Returns the new task id. " +
      "Set assignee to an agent, deps to task ids that must finish first, and input " +
      "to a structured payload for the agent. Execute the plan by calling runBoard once " +
      "all tasks are assigned.",
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
      const task = await collection.addTask({
        goal: input.goal,
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.deps !== undefined ? { deps: input.deps } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
      return { ok: true as const, taskId: task.id };
    },
  });

  const assignTask = handler({
    name: "assignTask",
    description: "Reassign an existing task to a different worker.",
    inputSchema: z.object({ taskId: z.string(), assignee: z.string() }),
    outputSchema: okOrError,
    parentStateSchema,
    execute: (input, ctx) =>
      withTask(ctx, input.taskId, (c) => c.setAssignee(input.taskId, input.assignee)),
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
      withTask(ctx, input.taskId, async (c) => {
        const { patch } = input;
        if (patch.priority !== undefined) await c.setPriority(input.taskId, patch.priority);
        if (patch.assignee !== undefined) await c.setAssignee(input.taskId, patch.assignee);
        if (patch.metadata !== undefined) await c.patchMetadata(input.taskId, patch.metadata);
        if (patch.addLabel !== undefined) await c.addLabel(input.taskId, patch.addLabel);
        if (patch.removeLabel !== undefined) await c.removeLabel(input.taskId, patch.removeLabel);
      }),
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
 */
export function buildTaskToolsList(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
) {
  return buildTaskTools(resolveCollection);
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
 */
export function createTaskToolsCapability(
  resolveCollection: TaskCollectionResolver = defaultOwnStateResolver,
): DefinedCapability {
  return defineCapability({
    name: "taskTools",
    presets: {
      tools: {
        tools: buildTaskTools(resolveCollection),
      },
      default: ["tools"],
    },
  });
}

/** Default instance for direct `uses: [taskTools]` wiring (own-state board). */
export const taskTools = createTaskToolsCapability();
