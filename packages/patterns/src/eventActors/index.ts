/**
 * eventActors pattern — stigmergic multi-agent coordination on the
 * unified TaskCollection substrate.
 *
 * Actors subscribe to entry topics via glob patterns. When an entry is
 * emitted, every actor whose `watch` matches gets a Task; the
 * substrate's `taskBoard` drains them concurrently. With `reEmit`,
 * actor outputs that conform to the entry shape are appended back to
 * the workspace and dispatched again as new tasks (depth-capped via
 * `maxDepth`).
 *
 * The entry log lives as a sibling writable resource — Tasks are about
 * actor invocations, not entry storage. This matches the FIX-443 audit
 * call: "TaskCollection drives actor-dispatch; entry log stays as content."
 *
 * Pipeline shape (per `eventActors.emit` invocation):
 *
 *   sequencer
 *     .tap(appendEntry)            // append the seed entry to workspace
 *     .tap(spawnInitialTasks)      // one Task per matching actor (depth=1)
 *     .then(taskBoard.block)       // drain — workers re-emit recursively
 *
 * Each worker (the actor body wrapped):
 *
 *   .tap(stashDepth)               // remember `task.metadata.depth`
 *   .map(unwrapToEntry)            // pass entry to user actor body
 *   .then(actor.block)             // user code
 *   .tap(reEmitIfEnabled)          // append entries from output, spawn next-depth tasks
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type {
  BlockContext,
  BlockDefinition,
  DefinedResource,
} from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskWorkerInput,
  type TaskWorkerRegistry,
} from "@flow-state-dev/tasks";
import { taskBoard, taskWorkerInputSchema } from "../task-board";
import { matchTopic } from "./match-topic";
import {
  createEventActorsWorkspaceResource,
  eventActorsWorkspaceStateSchema,
  type EventActorsWorkspaceState,
} from "./schemas";
import { createAppendEntry } from "./blocks/append-entry";

export {
  createEventActorsWorkspaceResource,
  eventActorsWorkspaceStateSchema,
} from "./schemas";
export type { EventActorsWorkspaceState } from "./schemas";
export { matchTopic, compilePattern } from "./match-topic";
export { createAppendEntry } from "./blocks/append-entry";

// ---------------------------------------------------------------------------
// Entry normalization
// ---------------------------------------------------------------------------

type EntryLike = { type: string; topic: string; body: unknown };

/**
 * Normalises actor body output into an array of entry objects suitable
 * for re-emission. Returns only objects that have `type` (string),
 * `topic` (string), and `body` fields. Non-entry values are dropped.
 */
export function normalizeToEntries(output: unknown): EntryLike[] {
  if (output == null) return [];

  let raw: unknown = output;
  if (
    !Array.isArray(raw) &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, unknown>).entries)
  ) {
    raw = (raw as Record<string, unknown>).entries as unknown[];
  }

  const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
  return candidates.filter(
    (item): item is EntryLike =>
      item != null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).type === "string" &&
      typeof (item as Record<string, unknown>).topic === "string" &&
      "body" in (item as Record<string, unknown>)
  );
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export interface ActorConfig {
  /** Unique name for this actor — also the worker-registry key. */
  name: string;

  /**
   * Glob patterns over `${type}:${topic}` that this actor subscribes to.
   * Must have at least one pattern. `*` matches a single segment, `**`
   * matches any number of segments.
   */
  watch: string[];

  /**
   * Block to execute when a matching entry is emitted. Receives the
   * entry as input (NOT TaskWorkerInput — the wrapper unwraps it). Can
   * be any block kind.
   */
  block: BlockDefinition<any, any>;
}

export type Actor = Readonly<ActorConfig>;

/** Frozen actor descriptor. */
export function actor(config: ActorConfig): Actor {
  if (config.watch.length === 0) {
    throw new Error(
      `[eventActors] Actor "${config.name}" must have at least one watch pattern`
    );
  }
  return Object.freeze({ ...config });
}

// ---------------------------------------------------------------------------
// Workspace factory
// ---------------------------------------------------------------------------

export interface EventActorsWorkspaceConfig {
  /** Workspace name — used as resource-name prefix. */
  name: string;
  /**
   * Zod schema describing entry shape. Stored as documentation; the
   * resource itself stores entries as `z.any()` to avoid generic depth
   * issues.
   */
  entries: ZodTypeAny;
}

/**
 * Creates an eventActors workspace — the writable resource that stores
 * the entry log. Pair with `eventActors({ workspace, actors, ... })`.
 */
export function createEventActorsWorkspace(
  _config: EventActorsWorkspaceConfig
): { workspace: DefinedResource } {
  return { workspace: createEventActorsWorkspaceResource() };
}

// ---------------------------------------------------------------------------
// eventActors factory
// ---------------------------------------------------------------------------

export interface EventActorsConfig {
  /** Pattern instance name. Block-name prefix and TaskCollection id. */
  name: string;

  /** Workspace — result of `createEventActorsWorkspace(...)`. */
  workspace: { workspace: DefinedResource };

  /**
   * Actors to register. Each actor's `watch` patterns determine which
   * entries trigger its `body` block. Must have at least one actor.
   */
  actors: Actor[];

  /** Maximum concurrent workers in the underlying taskBoard. Default: 16. */
  concurrency?: number;

  /**
   * When true, actor body outputs that conform to the entry shape
   * (`{ type, topic, body }`) are automatically appended to the
   * workspace and dispatched as new tasks to matching actors —
   * creating recursive reactive chains.
   */
  reEmit?: boolean;

  /**
   * Maximum re-emission depth. Only meaningful when `reEmit` is true.
   * At `maxDepth`, actor bodies still run but their output is appended
   * without further dispatch. Default: 3.
   */
  maxDepth?: number;
}

export interface EventActorsHandle {
  /** Sequencer block: appends entry + drains matching actors. */
  emit: SequencerDefinition<any, any>;
  /** The workspace resource. Declare on your flow's `resources`. */
  workspace: DefinedResource;
  /** The registered actors (frozen). */
  actors: readonly Actor[];
}

/**
 * Wires actors to a workspace and returns the `emit` block. Internally
 * composes `taskBoard` for the concurrent drain.
 */
export function eventActors(config: EventActorsConfig): EventActorsHandle {
  const {
    name,
    actors,
    // FIX-660: default lowered from 16 → 4 to align with peer patterns
    // (taskBoard=4, supervisor=3, parallelTasks=3). The 16 default
    // predated the `.waitForCondition` wiring; once wake-storm costs
    // were exposed, 16 was a 4× outlier with no architectural rationale.
    // Callers who want more can still pass `concurrency: 16` explicitly.
    concurrency = 4,
    reEmit = false,
    maxDepth = 3,
  } = config;
  const workspaceResource = config.workspace.workspace;

  if (actors.length === 0) {
    throw new Error(
      `[eventActors] "${name}" must have at least one actor`
    );
  }

  const collectionId = `eventActors:${name}`;
  const RESOURCE_KEY = "eventedActors";
  const appendEntry = createAppendEntry(name, workspaceResource, RESOURCE_KEY);

  function getCollection(ctx: BlockContext): TaskCollectionRef {
    return getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId,
    });
  }

  function matchingActors(entry: { type: string; topic: string }): Actor[] {
    const topicKey = `${entry.type ?? ""}:${entry.topic ?? ""}`;
    return actors.filter((a) =>
      a.watch.some((pattern) => matchTopic(pattern, topicKey))
    );
  }

  // Spawns one Task per matching actor at the given depth. Used both
  // for the initial emit and for reEmit fan-out from inside actor bodies.
  async function spawnTasksFor(
    entry: { type: string; topic: string; body: unknown },
    depth: number,
    ctx: BlockContext
  ): Promise<void> {
    const collection = getCollection(ctx);
    for (const matched of matchingActors(entry)) {
      await collection.addTask({
        goal: `${matched.name} on ${entry.type}:${entry.topic}`,
        assignee: matched.name,
        input: entry,
        metadata: { depth, type: entry.type, topic: entry.topic },
      });
    }
  }

  // Top-of-emit: append the seed entry, spawn depth-1 tasks for matching actors.
  const spawnInitialTasks = handler({
    name: `${name}-spawn-initial`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    resources: { [RESOURCE_KEY]: workspaceResource },
    execute: async (entry, ctx) => {
      const e = entry as { type: string; topic: string; body: unknown };
      await spawnTasksFor(e, 1, ctx as unknown as BlockContext);
      return entry;
    },
  });

  const actorWrapperStateSchema = z.object({
    _taskId: z.string().optional(),
  });

  // Build the worker registry — one wrapped block per actor.
  const workerRegistry: TaskWorkerRegistry = {};
  for (const a of actors) {
    workerRegistry[a.name] = buildActorWorker(a);
  }

  function buildActorWorker(a: Actor) {
    const reEmitTap = handler({
      name: `${name}-${a.name}-reemit`,
      inputSchema: z.any(),
      outputSchema: z.any(),
      resources: { [RESOURCE_KEY]: workspaceResource },
      sequencerStateSchema: actorWrapperStateSchema,
      execute: async (output, ctx) => {
        if (!reEmit) return output;

        const seqState = ctx.sequencer?.state as
          | { _taskId?: string }
          | undefined;
        const taskId = seqState?._taskId;
        if (!taskId) return output;

        const widerCtx = ctx as unknown as BlockContext;
        const collection = getCollection(widerCtx);
        const task = collection.get(taskId);
        const depth =
          (task?.metadata as { depth?: number } | undefined)?.depth ?? 1;

        const entries = normalizeToEntries(output);
        if (entries.length === 0) return output;

        const workspaceRef = (ctx.resources as Record<string, any>)[RESOURCE_KEY];
        for (const entry of entries) {
          // Append entry to the workspace resource (dedup on type+topic).
          const wsState =
            (workspaceRef.state) as EventActorsWorkspaceState;
          const entryType = entry.type;
          const entryTopic = entry.topic;
          const isDuplicate = wsState.entries.some(
            (e: Record<string, unknown>) =>
              e.type === entryType && e.topic === entryTopic
          );
          if (!isDuplicate) {
            await workspaceRef.patchState({
              entries: [...wsState.entries, entry],
            });
            ctx.emitComponent(
              "rb-entry",
              { type: entryType, topic: entryTopic, body: entry.body },
              { key: `entry-${wsState.entries.length}` }
            );
          }
          if (depth + 1 <= maxDepth) {
            await spawnTasksFor(entry, depth + 1, widerCtx);
          }
        }
        return output;
      },
    });

    const stashTaskId = handler({
      name: `${name}-${a.name}-stash`,
      inputSchema: taskWorkerInputSchema,
      outputSchema: taskWorkerInputSchema,
      sequencerStateSchema: actorWrapperStateSchema,
      execute: async (input, ctx) => {
        await ctx.sequencer!.patchState({ _taskId: input.taskId });
        return input;
      },
    });

    return sequencer({
      name: `${name}-actor-${a.name}`,
      inputSchema: taskWorkerInputSchema,
      stateSchema: actorWrapperStateSchema,
    })
      .then(stashTaskId)
      .map((input: TaskWorkerInput) => input.input)
      .then(a.block)
      .tap(reEmitTap);
  }

  const board = taskBoard({
    name: `${name}-board`,
    collection: { backing: "request", collectionId },
    workers: workerRegistry,
    concurrency,
    dispatcher: "fifo",
    onIdle: "complete",
  });

  const emit = sequencer({
    name: `${name}-emit`,
    inputSchema: z.any(),
    container: { component: "evented-actors" },
  })
    .tap(appendEntry)
    .tap(spawnInitialTasks)
    .then(board.block);

  return {
    emit,
    workspace: workspaceResource,
    actors: Object.freeze([...actors]),
  };
}

