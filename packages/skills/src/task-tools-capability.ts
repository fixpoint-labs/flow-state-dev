/**
 * `taskTools` capability — programmatic surface for the active pattern's
 * TaskCollection.
 *
 * Pattern-mode skills get a declarative dispatcher and worker registry.
 * When that's not enough — a generator wants to enqueue follow-up work
 * mid-flow, mark a task complete from a side channel, or query the
 * board — `taskTools` exposes eight handler-shaped tools agents call
 * by name.
 *
 * Tools resolve the live collection via `getActivePatternCollection`,
 * which walks `ctx.session.state.activeSkills` for the most recent
 * `mode: "pattern"` entry. With no pattern active, every tool returns
 * `{ error: "no_active_pattern" }` rather than throwing — agents
 * should recover gracefully from misuse.
 */

import { defineCapability, handler, type DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { getActivePatternCollection } from "./active-pattern-collection";
import type { TaskCollectionRef } from "@flow-state-dev/tasks";

// ---------------------------------------------------------------------------
// Shared error contract
// ---------------------------------------------------------------------------

const noActivePatternError = { ok: false as const, error: "no_active_pattern" };
const taskNotFoundError = (id: string) => ({ ok: false as const, error: "task_not_found", taskId: id });

/** Shared output shape for the six tasked-by-id mutators. */
const okOrError = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), taskId: z.string().optional() }),
]);

function getCollection(ctx: BlockContext): TaskCollectionRef | undefined {
  return getActivePatternCollection(ctx);
}

/**
 * Run a mutator against the active pattern's TaskCollection for a known
 * task id. Returns the no-pattern / not-found structured error when
 * appropriate, otherwise `{ ok: true }` after the mutator resolves.
 */
async function withTask(
  ctx: BlockContext,
  taskId: string,
  mutator: (collection: TaskCollectionRef) => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: string; taskId?: string }> {
  const collection = getCollection(ctx);
  if (!collection) return noActivePatternError;
  if (!collection.get(taskId)) return taskNotFoundError(taskId);
  await mutator(collection);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

const addTask = handler({
  name: "addTask",
  description:
    "Add a new task to the active pattern's task board. Returns the new task id.",
  inputSchema: z.object({
    goal: z.string(),
    assignee: z.string().optional(),
    deps: z.array(z.string()).optional(),
    priority: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.union([
    z.object({ ok: z.literal(true), taskId: z.string() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
  execute: async (input, ctx) => {
    const collection = getCollection(ctx);
    if (!collection) return noActivePatternError;
    const task = await collection.addTask({
      goal: input.goal,
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      ...(input.deps !== undefined ? { deps: input.deps } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
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
  execute: (input, ctx) =>
    withTask(ctx, input.taskId, (c) => c.setAssignee(input.taskId, input.assignee)),
});

const completeTask = handler({
  name: "completeTask",
  description: "Mark a task complete with its output.",
  inputSchema: z.object({ taskId: z.string(), output: z.unknown() }),
  outputSchema: okOrError,
  execute: (input, ctx) =>
    withTask(ctx, input.taskId, (c) => c.complete(input.taskId, input.output)),
});

const failTask = handler({
  name: "failTask",
  description: "Mark a task failed with an error message.",
  inputSchema: z.object({ taskId: z.string(), error: z.string() }),
  outputSchema: okOrError,
  execute: (input, ctx) =>
    withTask(ctx, input.taskId, (c) => c.fail(input.taskId, input.error)),
});

const blockTask = handler({
  name: "blockTask",
  description: "Block a task pending an external condition.",
  inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
  outputSchema: okOrError,
  execute: (input, ctx) =>
    withTask(ctx, input.taskId, (c) => c.block(input.taskId, input.reason)),
});

const cancelTask = handler({
  name: "cancelTask",
  description: "Cancel a task (terminal). Use when the work is no longer needed.",
  inputSchema: z.object({ taskId: z.string(), reason: z.string().optional() }),
  outputSchema: okOrError,
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
    "List tasks on the active board, optionally filtered by status or assignee.",
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
  execute: async (input, ctx) => {
    const collection = getCollection(ctx);
    if (!collection) return noActivePatternError;
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

// ---------------------------------------------------------------------------
// Capability factory
// ---------------------------------------------------------------------------

/**
 * Build the `taskTools` capability. Eight tools registered under one
 * capability so consumers wire it via `uses: [taskTools]`. The
 * capability has no presets — all tools install by default.
 */
export function createTaskToolsCapability(): DefinedCapability {
  return defineCapability({
    name: "taskTools",
    presets: {
      tools: {
        tools: [
          addTask,
          assignTask,
          completeTask,
          failTask,
          blockTask,
          cancelTask,
          updateTask,
          listTasks,
        ],
      },
      default: ["tools"],
    },
  });
}

/** Default instance for direct `uses: [taskTools]` wiring. */
export const taskTools = createTaskToolsCapability();
