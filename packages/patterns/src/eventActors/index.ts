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
 *     .step(taskBoard.drain)       // drain — workers re-emit recursively
 *
 * Each worker (the actor body wrapped):
 *
 *   .tap(stashDepth)               // remember `task.metadata.depth`
 *   .map(unwrapToEntry)            // pass entry to user actor body
 *   .step(actor.block)             // user code
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
  resolveTaskCapDefaults,
  RETRY_BUDGET_NOT_APPLICABLE,
  type TaskCapOptions,
  type TaskCollectionRef,
  type TaskInit,
  type TaskWorkerInput,
  type TaskWorkerRegistry,
} from "@flow-state-dev/orchestration";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
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

  /**
   * Creation bounds for the internal board (FIX-931). Defaults 500/100 —
   * unchanged behavior when unset. A long-running reactive chain can
   * legitimately exceed them, so both are reachable here: raise the number, or
   * pass `null` for explicitly unbounded on that axis.
   */
  maxTotalTasks?: number | null;
  maxEnqueuedTasks?: number | null;
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

  // ONE definition of this board's creation bounds (FIX-931), spread into both
  // the board below and `getCollection` here. Actor spawning resolves the
  // board's ledger into its own `TaskCollectionRef`, and the caps are closed
  // over per-ref — so a resolver built without them writes past the bounds the
  // board advertises. Resolved up here rather than read off `board.caps`
  // because `getCollection` is declared before the board is built.
  // The retry budget (FIX-948) is explicitly OPTED OUT, not merely left
  // unexposed. An `eventActors` board builds its task inits directly and never
  // stamps a `maxAttempts`, so its tasks cannot retry and a budget here has no
  // subject. Omission would not refuse it: this object is spread into BOTH the
  // collection constructor and `taskBoard` below, and each of those defaults an
  // absent axis again — so the board would carry an inert, non-configurable cap
  // that starts binding the moment this surface gains `maxAttempts`. `null` is
  // the value that survives defaulting.
  const boardCaps = resolveTaskCapDefaults(`[eventActors] "${name}"`, {
    maxTotalTasks: config.maxTotalTasks,
    maxEnqueuedTasks: config.maxEnqueuedTasks,
    maxTotalRetries: RETRY_BUDGET_NOT_APPLICABLE,
  });

  async function getCollection(ctx: BlockContext): Promise<TaskCollectionRef> {
    return getOrCreateTaskCollection({
      ctx,
      backing: "request",
      collectionId,
      ...boardCaps,
    });
  }

  function matchingActors(entry: { type: string; topic: string }): Actor[] {
    const topicKey = `${entry.type ?? ""}:${entry.topic ?? ""}`;
    return actors.filter((a) =>
      a.watch.some((pattern) => matchTopic(pattern, topicKey))
    );
  }

  /**
   * The `TaskInit`s one entry would spawn — built, not inserted, so a caller
   * handling several entries can submit them as ONE batch (FIX-931). Separating
   * "what to create" from "create it" is what lets the unit of atomicity be the
   * caller's, rather than being fixed at one entry.
   */
  function taskInitsFor(
    entry: { type: string; topic: string; body: unknown },
    depth: number
  ): TaskInit[] {
    return matchingActors(entry).map((actor) => ({
      goal: `${actor.name} on ${entry.type}:${entry.topic}`,
      assignee: actor.name,
      input: entry,
      metadata: { depth, type: entry.type, topic: entry.topic },
    }));
  }

  // Spawns every Task one entry matches, atomically. The initial emit handles a
  // single entry, so its batch is that entry's actors; the re-emission path
  // batches across ALL entries itself (see `reEmitTap`).
  async function spawnTasksFor(
    entry: { type: string; topic: string; body: unknown },
    depth: number,
    ctx: BlockContext
  ): Promise<void> {
    const inits = taskInitsFor(entry, depth);
    if (inits.length === 0) return;
    const collection = await getCollection(ctx);
    await collection.addTasks(inits);
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
        const collection = await getCollection(widerCtx);
        const task = collection.get(taskId);
        const depth =
          (task?.metadata as { depth?: number } | undefined)?.depth ?? 1;

        const entries = normalizeToEntries(output);
        if (entries.length === 0) return output;

        const workspaceRef = (ctx.resources as Record<string, any>)[RESOURCE_KEY];

        // The unit of atomicity is the whole RE-EMISSION, not one entry
        // (FIX-931). Making a single entry's actors atomic still left the loop
        // across entries partial: with the budget nearly full, entry one commits
        // and entry two throws, so the source task errors with part of its
        // output already dispatched. Everything this output wants to spawn goes
        // in ONE `addTasks`, submitted before any state is committed.
        const seen = new Set(
          (workspaceRef.state as EventActorsWorkspaceState).entries.map(
            (e: Record<string, unknown>) => JSON.stringify([e.type, e.topic]),
          ),
        );
        const toAppend: EntryLike[] = [];
        const inits: TaskInit[] = [];
        for (const entry of entries) {
          // Dedup on type+topic, WITHIN this batch as well as against what the
          // workspace already holds — the old loop got the within-batch half for
          // free by re-reading state after each `patchState`.
          const key = JSON.stringify([entry.type, entry.topic]);
          if (!seen.has(key)) {
            seen.add(key);
            toAppend.push(entry);
          }
          // Deliberately NOT gated on the dedup: a repeated entry still spawns
          // its actors, exactly as before.
          if (depth + 1 <= maxDepth) inits.push(...taskInitsFor(entry, depth + 1));
        }

        // WORKSPACE FIRST, then one atomic dispatch.
        //
        // `addTasks` publishes pending tasks and emits their task-change items,
        // so an idle board worker can claim and run an actor the moment it
        // returns. Anything that actor needs in the shared log must already be
        // there. Dispatching first raced on every re-emission under
        // `concurrency > 1`; the original per-entry loop appended before
        // spawning, and this keeps that ordering while strengthening it —
        // EVERY entry is visible before ANY task is dispatched, where the old
        // loop only guaranteed it for the entry it was on.
        //
        // The cost is the reverse case: a re-emission refused by the creation
        // bound leaves entries recorded whose actors never ran. That is the
        // better trade. It happens only at the bound rather than on every
        // re-emission, the workspace is an observation log (the actor really
        // did emit those entries), and the source task errors loudly at the
        // same moment — where the racing worker fails silently, with a
        // half-populated log that looks legitimate.
        for (const entry of toAppend) {
          const wsState = workspaceRef.state as EventActorsWorkspaceState;
          await workspaceRef.patchState({ entries: [...wsState.entries, entry] });
          ctx.emit.component(
            "rb-entry",
            { type: entry.type, topic: entry.topic, body: entry.body },
            { key: `entry-${wsState.entries.length}` }
          );
        }

        if (inits.length > 0) {
          const collectionForSpawn = await getCollection(widerCtx);
          await collectionForSpawn.addTasks(inits);
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
      .step(stashTaskId)
      .map((input: TaskWorkerInput) => input.input)
      .step(a.block)
      .tap(reEmitTap);
  }

  const board = taskBoard({
    name: `${name}-board`,
    collection: { collectionId },
    // Same resolved bounds `getCollection` uses — spread rather than restated,
    // so the board and the actor-spawn writer can never disagree (FIX-931).
    ...boardCaps,
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
    .step(board.drain);

  return {
    emit,
    workspace: workspaceResource,
    actors: Object.freeze([...actors]),
  };
}

