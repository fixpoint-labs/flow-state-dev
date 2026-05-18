/**
 * Task Board Pattern (FIX-446)
 *
 * Concurrent drain over a `TaskCollection` with dependency gating and
 * per-task worker routing. The unified Plan/Task primitive's canonical
 * validation case: dispatch is CAS-safe, workers are routed by
 * `task.assignee`, mid-drain enqueues are picked up automatically, and
 * `awaiting_review` is correctly handled (skip + wait) for the HITL
 * forward-compat surface that ships in Wave 2.
 *
 * ## Pipeline shape
 *
 * Outer sequencer:
 *   `.tap(seedCollection?) → .forEach(workerId, makeWorker)`
 *
 * Each worker (own sequencer state):
 *   `.then(claimTask)
 *      .thenIf(claimed, claim → task, workerBody)
 *      .then(checkBoard)
 *      .loopBack(claimTask, when=shouldContinue)`
 *
 * `workerBody`:
 *   `.then(workerStep) .tap(recordSuccess) .rescue(recordError)`
 *
 * `workerStep` is the user's worker block directly (uniform case) OR
 * a `router` that selects by `task.assignee` (registry case). The
 * worker block runs as a first-class step in the sequencer — it is
 * NOT invoked from inside another block's `execute` (BP-011).
 *
 * `recordSuccess` reads `currentTaskId` from the worker's own
 * sequencer state and calls `collection.complete`. `recordError` runs
 * via `.rescue()` and calls `collection.fail` against the same
 * per-state `currentTaskId` — so a thrown error fails exactly one
 * task, never a sibling's concurrently-claimed work.
 *
 * ## Termination
 *
 * - `onIdle: 'complete'` (default): exit when no `pending`,
 *   `in_progress`, or `awaiting_review` tasks remain.
 *   `awaiting_review` keeps the loop alive — workers idle-poll until
 *   an external actor transitions the task out.
 *
 * - `onIdle: 'wait'`: never exit on drained-ness. Defer to
 *   `shouldExit`; the loop runs until that returns `true` or
 *   `maxIterations` trips.
 *
 * ## CAS-safe dispatch
 *
 * The substrate's `collection.claim` runs eligibility scan + CAS flip
 * inside one mutator pass; under contention exactly one worker wins
 * and the other immediately re-scans for the next eligible task. No
 * pattern-level coordination beyond that.
 */
import { sequencer } from "@flow-state-dev/core";
import type { DefinedCapability, SequencerDefinition } from "@flow-state-dev/core";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorker,
  type TaskWorkerRegistry,
} from "@flow-state-dev/tasks";
import {
  createTaskBoardCapability,
  type TaskBoardCapabilityAccessor,
} from "./capability";

import {
  taskBoardStateSchema,
  taskBoardWorkerStateSchema,
  taskBoardWorkerBodyStateSchema,
  type ClaimResult,
} from "./schemas";
import type { Task } from "@flow-state-dev/tasks";
import { resolveDispatcher, type TaskBoardDispatcherInput } from "./shared";
import { createSeedCollection } from "./blocks/seed-collection";
import { createClaimTask } from "./blocks/claim-task";
import { buildWorkerStep } from "./blocks/worker-step";
import {
  createRecordSuccess,
  createRecordError,
} from "./blocks/record-result";
import { createCheckBoard } from "./blocks/check-board";
import {
  createBoardMetaActive,
  createBoardMetaCompleted,
} from "./blocks/board-meta";
import {
  createFlowPolicyResolver,
  createInstallBoardFlowState,
  createTeardownBoardFlowState,
  stampCurrentTaskId,
  type BoardRunFlowState,
} from "./flow-policy-wiring";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  taskBoardStateSchema,
  taskBoardWorkerStateSchema,
  taskBoardWorkerBodyStateSchema,
  claimResultSchema,
  taskWorkerInputSchema,
  checkBoardOutputSchema,
} from "./schemas";
export type {
  TaskBoardState,
  TaskBoardWorkerState,
  TaskBoardWorkerBodyState,
  ClaimResult,
  CheckBoardOutput,
} from "./schemas";
export type { TaskBoardDispatcherInput } from "./shared";
export { createSeedCollection } from "./blocks/seed-collection";
export type { SeedCollectionOptions } from "./blocks/seed-collection";
export {
  createSelectNextReadyTask,
  selectNextReadyTaskOutputSchema,
} from "./blocks/select-next-ready-task";
export type {
  SelectNextReadyTaskOptions,
  SelectNextReadyTaskOutput,
} from "./blocks/select-next-ready-task";
export { createClaimTask } from "./blocks/claim-task";
export type { ClaimTaskOptions, ClaimTaskOutput } from "./blocks/claim-task";
export {
  buildWorkerStep,
  isUniformWorker,
  packWorkerInput,
} from "./blocks/worker-step";
export type { BuildWorkerStepOptions } from "./blocks/worker-step";
export {
  createRecordSuccess,
  createRecordError,
} from "./blocks/record-result";
export type {
  RecordSuccessOptions,
  RecordErrorOptions,
} from "./blocks/record-result";
export { createCheckBoard } from "./blocks/check-board";
export type { CheckBoardOptions } from "./blocks/check-board";
export {
  createBoardMetaActive,
  createBoardMetaCompleted,
  TASK_BOARD_META_COMPONENT_TYPE,
} from "./blocks/board-meta";
export type { BoardMetaOptions } from "./blocks/board-meta";
export {
  createTaskBoardCapability,
  type TaskBoardCapabilityOptions,
  type TaskBoardCapabilityAccessor,
} from "./capability";
export type { BoardRunFlowState } from "./flow-policy-wiring";

// ---------------------------------------------------------------------------
// Public config / handle
// ---------------------------------------------------------------------------

/**
 * Sequencer-state-backed collection spec. The pattern wires
 * `getOrCreateTaskCollection({ backing: "sequencer", sequencer:
 * <board-state-ref> })` at runtime. The outer sequencer's
 * `stateSchema` must include a `Record<string, Task>` slot at
 * `[stateKey]` (default `"tasks"`) — `taskBoardStateSchema` is the
 * canonical shape.
 *
 * Single-invocation only. If a board needs to be re-entered from
 * inside an outer loop (e.g. a replan loop that calls `board.block`
 * across iterations), use `TaskBoardRequestCollectionSpec` instead —
 * sequencer state is per-invocation and won't survive across calls.
 */
export interface TaskBoardSequencerCollectionSpec {
  backing?: "sequencer";
  collectionId: string;
  stateKey?: string;
}

/**
 * Request-scoped collection spec (FIX-471). Tasks live on
 * `ctx.request` so the collection survives every block boundary —
 * including multiple invocations of `board.block` from a parent
 * sequencer's outer loop. The `tasks` record persists for the request
 * lifetime; cross-request boards still want
 * `TaskBoardCollectionFactory` with a session/user/org-scoped resource
 * collection.
 *
 * The capability built for this backing does NOT declare
 * `targetStateSchemas` (the storage isn't on a parent sequencer slot)
 * and reaches the collection via `getOrCreateTaskCollection({ backing:
 * "request" })` from any block in the request, not just blocks running
 * under `board.block`'s subtree.
 */
export interface TaskBoardRequestCollectionSpec {
  backing: "request";
  collectionId: string;
  /**
   * Top-level field on `ctx.request.state` holding the
   * `Record<id, Task>`. Defaults to `collectionId` so multiple boards
   * in one request stay namespaced without manual setup.
   */
  stateKey?: string;
}

/** Caller-supplied factory — full control. Receives the worker's `BlockContext`. */
export type TaskBoardCollectionFactory<TInput, TOutput> = (
  ctx: BlockContext
) => TaskCollectionRef<TInput, TOutput>;

export interface TaskBoardConfig<TInput = unknown, TOutput = unknown> {
  /**
   * Name for this task board. Used as the outer sequencer name and as a
   * prefix for every internal block name (must be globally unique inside
   * a flow if you have multiple boards).
   */
  name: string;

  /**
   * Where the collection lives. One of:
   *
   * - `TaskBoardSequencerCollectionSpec` (default) — tasks on the
   *   board's own sequencer state. Single-invocation; per-call state.
   * - `TaskBoardRequestCollectionSpec` (FIX-471) — tasks on
   *   `ctx.request`. Re-enterable across multiple `board.block`
   *   invocations within the same request.
   * - `TaskBoardCollectionFactory<TInput, TOutput>` — caller-supplied
   *   `(ctx) => collection` for advanced cases (resource-collection
   *   backed, externally managed collections, etc.).
   */
  collection:
    | TaskBoardSequencerCollectionSpec
    | TaskBoardRequestCollectionSpec
    | TaskBoardCollectionFactory<TInput, TOutput>;

  /**
   * Worker(s) to dispatch tasks to. A single uniform worker runs
   * every claimed task; a registry routes by `task.assignee`. Workers
   * are standard `BlockDefinition`s consuming the substrate's
   * `TaskWorkerInput` shape.
   */
  workers: TaskWorker<TInput, TOutput> | TaskWorkerRegistry;

  /**
   * Maximum parallel workers. Default: 4. The pattern spawns exactly
   * this many worker sequencers via `.forEach({ maxConcurrency })`.
   */
  concurrency?: number;

  /**
   * Dispatcher for ready-task selection. Either a `TaskDispatcher`
   * instance or a string naming one of the standard dispatchers
   * (`"fifo"`, `"topological"`, `"priority"`). Default: `"topological"`.
   */
  dispatcher?: TaskBoardDispatcherInput;

  /**
   * Termination behavior when the worker pool is idle.
   *
   * - `"complete"` (default): exit when no `pending`, `in_progress`,
   *   or `awaiting_review` tasks remain. Single-pass drain.
   * - `"wait"`: never auto-exit; defer to `shouldExit`. Long-running
   *   session-scoped boards.
   */
  onIdle?: "wait" | "complete";

  /** Tasks seeded into the collection at board start. Optional. */
  initialTasks?: readonly TaskInit<TInput>[];

  /**
   * Worker-failure policy. Default: `"skip"`.
   *
   * - `"skip"`: capture error on the failing task via `fail`,
   *   siblings continue.
   * - `"fail"`: the worker sequencer rethrows after writing `fail`,
   *   the parent forEach rejects, the board fails.
   *
   * Fails the offending task only — siblings concurrently in-progress
   * are unaffected because each worker tracks its own `currentTaskId`
   * in worker state.
   */
  onError?: "skip" | "fail";

  /**
   * Per-worker `loopBack` safety cap. Each worker exits after this
   * many iterations even if the board is non-empty. Circuit-breaker
   * for pathological enqueue cycles. Default: 10_000.
   */
  maxIterations?: number;

  /**
   * Predicate for `onIdle: 'wait'` — return `true` to terminate the
   * loop. Evaluated once per iteration in `checkBoard`. Ignored in
   * `onIdle: 'complete'` mode.
   */
  shouldExit?: (collection: TaskCollectionRef) => boolean;

  /**
   * Sleep duration when a worker's claim returns null. Bounds the
   * busy-wait cost while waiting for new pending tasks (or for an
   * `awaiting_review` task to be resumed). Default: 50ms.
   */
  idlePollMs?: number;

  /**
   * Per-board tool-result memoization (FIX-610 Layer B). Enabled
   * automatically when any worker tool declares `cacheable`; pass
   * `false` to disable, or an object to tune. The cache is bound to a
   * single board run — it's torn down whether the board completes or
   * errors, so cross-run leakage stays impossible by construction.
   */
  toolCache?: TaskBoardToolCacheConfig | boolean;

  /**
   * Per-board flow policy (FIX-610 Layer A). Decides which prior-task
   * observations a soon-to-dispatch worker sees on
   * `TaskWorkerInput.priorWork`. Default: `flowPolicy.declaredDepsOnly()`
   * — wire-identical to pre-FIX-610 behavior. Pattern factories like
   * `planAndExecute` pin richer defaults (`recentTrajectory({ n: 8 })`).
   *
   * Typed as `unknown` here to keep `@flow-state-dev/patterns` from
   * depending on `@flow-state-dev/utilities-task-flow`. The concrete
   * shape is `TaskFlowPolicy` from that package.
   */
  flowPolicy?: unknown;
}

/**
 * Per-board tool-cache tuning (FIX-610). All fields optional.
 */
export interface TaskBoardToolCacheConfig {
  /** Default true when any tool in the board's worker(s) declares `cacheable`. */
  enabled?: boolean;
  /** Default TTL (ms) for cacheable tools that don't specify one. */
  defaultTtl?: number;
  /** Max entries before LRU eviction. Default 5000. */
  maxEntries?: number;
  /** Default scope for tools that don't specify one. Default `"run"`. */
  defaultScope?: "run" | "request" | "session";
}

export interface TaskBoardHandle {
  /**
   * The composed sequencer block. Plug into a parent flow or
   * sequencer.
   *
   * For the sequencer-backed default, the parent sequencer's
   * `stateSchema` MUST include a `Record<string, Task>` slot at
   * `[stateKey]` (default `"tasks"`). `taskBoardStateSchema` declares
   * the canonical shape.
   */
  block: SequencerDefinition<any, any>;
  /** Stable identifier for the collection — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;
  /**
   * Capability exposing the board's `TaskCollectionRef` at
   * `ctx.cap.taskBoard_<name>.tasks()`. Add to any block's `uses` array
   * to read or mutate the board's tasks from inside the board's
   * sequencer subtree (i.e. blocks executing under `board.block`).
   *
   * Backing-aware: sequencer-spec collections also auto-declare the
   * board's `tasks` slot via `targetStateSchemas`, so consumers don't
   * need to extend the parent flow's state schema by hand. Factory-
   * backed boards defer the collection construction to the user's
   * factory and skip the schema declaration.
   *
   * Note: the capability throws if used from a block running outside
   * the board sequencer (e.g. a sibling). State has to be in scope to
   * be mutated; falling back to the wrong sequencer would silently
   * corrupt unrelated state.
   */
  capability: DefinedCapability<string, TaskBoardCapabilityAccessor>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a Task Board pattern instance. See module doc for the
 * pipeline semantics and termination rules.
 */
export function taskBoard<TInput = unknown, TOutput = unknown>(
  config: TaskBoardConfig<TInput, TOutput>
): TaskBoardHandle {
  const {
    name,
    collection: collectionConfig,
    workers,
    concurrency = 4,
    dispatcher: dispatcherInput = "topological",
    onIdle = "complete",
    initialTasks = [],
    onError = "skip",
    maxIterations = 10_000,
    shouldExit,
    idlePollMs = 50,
    toolCache,
    flowPolicy: flowPolicyConfig,
  } = config;

  if (concurrency < 1) {
    throw new Error(
      `[task-board] "${name}" concurrency must be >= 1 (got ${concurrency})`
    );
  }
  if (maxIterations < 1) {
    throw new Error(
      `[task-board] "${name}" maxIterations must be >= 1 (got ${maxIterations})`
    );
  }
  if (idlePollMs < 0) {
    throw new Error(
      `[task-board] "${name}" idlePollMs must be >= 0 (got ${idlePollMs})`
    );
  }

  const dispatcher: TaskDispatcher = resolveDispatcher(dispatcherInput);
  const collectionFactory = buildCollectionFactory<TInput, TOutput>(
    name,
    collectionConfig
  );
  const collectionId = resolveCollectionId(collectionConfig);

  const seedBlock = createSeedCollection<TInput>({
    name: `${name}-seed`,
    collection: collectionFactory,
    initialTasks,
  });

  const boardMetaActive = createBoardMetaActive({
    name: `${name}-meta-active`,
    collection: collectionFactory,
    collectionId,
  });

  const boardMetaCompleted = createBoardMetaCompleted({
    name: `${name}-meta-completed`,
    collection: collectionFactory,
    collectionId,
  });

  const claimStepName = `${name}-worker-claim`;
  const claimTask = createClaimTask({
    name: claimStepName,
    collection: collectionFactory,
    dispatcher,
    workerId: (ctx) => resolveWorkerIdFromCtx(ctx, name),
  });

  // FIX-610 shared run-state bag — populated by `installFlowState`
  // at the top of the outer sequencer and consulted by every worker
  // dispatch. Cleared by `teardownFlowState` on both completion and
  // error paths so a board re-entered within the same request starts
  // each run fresh.
  const runState: BoardRunFlowState = { collectionId };
  const installFlowState = createInstallBoardFlowState({
    name,
    collectionId,
    flowPolicy: flowPolicyConfig,
    toolCache,
    collection: collectionFactory,
    runState,
  });
  const teardownFlowState = createTeardownBoardFlowState({ name, runState });

  const workerStep = buildWorkerStep({
    name,
    workers,
    collection: collectionFactory,
    resolveFlowPolicy: createFlowPolicyResolver(runState),
  });

  const recordSuccess = createRecordSuccess({
    name: `${name}-worker-record-success`,
    collection: collectionFactory,
  });

  const recordError = createRecordError({
    name: `${name}-worker-record-error`,
    collection: collectionFactory,
    onError,
  });

  const checkBoard = createCheckBoard({
    name: `${name}-worker-check-board`,
    collection: collectionFactory,
    onIdle,
    idlePollMs,
    shouldExit,
  });

  // Worker body: the worker block runs directly (BP-011 conformance —
  // no handler wrapping). The body sequencer owns its own state with
  // `currentTaskId`; the leading `.tap()` stamps the claimed task's
  // id so `recordSuccess` (success path) and `recordError`
  // (`.rescue()` path) can both read the same scoped value via
  // `ctx.sequencer`. Per-iteration scoping prevents stale ids from
  // leaking across loop turns.
  const workerBody = sequencer({
    name: `${name}-worker-body`,
    // `taskSchema` is intentionally NOT used as the inputSchema generic
    // arg here — embedding it as `typeof taskSchema` in the sequencer's
    // type chain causes TS depth-instantiation OOMs (same family as
    // `tasksRecordSchema` in schemas.ts). The runtime input is still a
    // `Task`; the framework validates shape via the substrate's own
    // CAS path before this body runs.
    stateSchema: taskBoardWorkerBodyStateSchema,
  })
    .tap(async (task: Task, ctx) => {
      await ctx.sequencer!.patchState({ currentTaskId: task.id });
      // FIX-610: also stamp the active task id onto the shared
      // run-state bag so any cacheable tool the worker invokes attributes
      // cache writes to this task (later hits get `sourceTask`).
      stampCurrentTaskId(runState, task);
    })
    .then(workerStep)
    .tap(recordSuccess)
    .rescue([{ block: recordError }]);

  function makeWorker(workerId: number) {
    return sequencer({
      name: `${name}-worker-${workerId}`,
      stateSchema: taskBoardWorkerStateSchema,
    })
      .then(claimTask)
      .thenIf(
        (out: ClaimResult) => out.claimed,
        // Connector: ClaimResult → Task (the workerStep's input).
        // `task` is guaranteed defined when claimed === true; the
        // non-null assertion is safe here.
        (out: ClaimResult) => out.task!,
        workerBody
      )
      .then(checkBoard)
      .loopBack(claimStepName, {
        when: (v) => (v as { shouldContinue?: boolean }).shouldContinue === true,
        maxIterations,
      });
  }

  const block = sequencer({
    name,
    stateSchema: taskBoardStateSchema,
  })
    // FIX-610: install run-scoped cache + ledger BEFORE seed so any
    // tool a seed handler might call (rare but possible via custom
    // seed paths) sees the binding too.
    .tap(installFlowState)
    .tap(boardMetaActive)
    .tap(seedBlock)
    .forEach(
      () => Array.from({ length: concurrency }, (_, i) => i),
      (workerId: number) => makeWorker(workerId),
      { maxConcurrency: concurrency }
    )
    .tap(boardMetaCompleted)
    // FIX-610: teardown on the success path. The `.rescue` below also
    // runs teardown on errors so cleanup is symmetric — leaving stale
    // run-state across re-entries inside the same request would
    // otherwise misattribute cache hits.
    .tap(teardownFlowState)
    .rescue([{ block: teardownFlowState }]);

  // Capability — backing-aware. Sequencer-spec collections get a
  // capability that auto-resolves the collection via the parent
  // sequencer's state ref AND declares the `tasks` slot transitively.
  // Request-spec collections (FIX-471) skip the schema declaration and
  // resolve the collection through `ctx.request` so re-entry works
  // across multiple `board.block` invocations. Caller-supplied factories
  // defer entirely to the user's factory function — useful for
  // resource-collection-backed boards or any custom storage. Either way
  // `board.capability` is always defined; consumers that opt into
  // `uses: [board.capability]` get a typed `ctx.cap["taskBoard.<name>"].tasks()`
  // accessor regardless of backing.
  const capability = isFactoryFn(collectionConfig)
    ? createTaskBoardCapability({
        backing: "factory",
        boardName: name,
        collectionId,
        factory: collectionConfig,
      })
    : createTaskBoardCapability({
        // `backing` is optional on TaskBoardSequencerCollectionSpec —
        // omitted spec defaults to sequencer, the historical mode.
        backing: collectionConfig.backing ?? "sequencer",
        boardName: name,
        collectionId: collectionConfig.collectionId,
        stateKey: collectionConfig.stateKey,
      });

  return { block, collectionId, capability };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isFactoryFn<TInput, TOutput>(
  c: TaskBoardConfig<TInput, TOutput>["collection"]
): c is TaskBoardCollectionFactory<TInput, TOutput> {
  return typeof c === "function";
}

/**
 * Build the runtime collection factory.
 *
 * - `sequencer` (default): `getOrCreateTaskCollection({ backing:
 *   "sequencer" })` against the board's `StateRef`, resolved via
 *   `ctx.getTarget(boardName)` so workers nested inside `.forEach`
 *   still address the shared task record. Falls back to
 *   `ctx.sequencer` for the top-level seed handler that runs directly
 *   under the board.
 * - `request` (FIX-471): `getOrCreateTaskCollection({ backing:
 *   "request" })`. The request scope's CAS surface is identical to a
 *   sequencer state ref's, so the underlying mutation engine is the
 *   same. State survives across multiple `board.block` invocations,
 *   which is the point of this backing.
 * - factory: caller-supplied `(ctx) => collection` passes through
 *   unchanged.
 */
function buildCollectionFactory<TInput, TOutput>(
  boardName: string,
  collectionConfig: TaskBoardConfig<TInput, TOutput>["collection"]
): (ctx: BlockContext) => TaskCollectionRef<TInput, TOutput> {
  if (isFactoryFn(collectionConfig)) return collectionConfig;

  if (collectionConfig.backing === "request") {
    const { collectionId, stateKey } = collectionConfig;
    return (ctx: BlockContext) =>
      getOrCreateTaskCollection<TInput, TOutput>({
        ctx,
        backing: "request",
        collectionId,
        stateKey,
      });
  }

  const { collectionId, stateKey } = collectionConfig;
  return (ctx: BlockContext) => {
    const target = ctx.getTarget<Record<string, unknown>>(boardName);
    const stateRef = (target ?? ctx.sequencer) as
      | StateRef<Record<string, unknown>>
      | undefined;
    if (stateRef === undefined) {
      throw new Error(
        `[task-board] sequencer-backed collection "${collectionId}" requires either ctx.getTarget("${boardName}") or ctx.sequencer — call this block inside the board sequencer`
      );
    }
    return getOrCreateTaskCollection<TInput, TOutput>({
      ctx,
      backing: "sequencer",
      collectionId,
      sequencer: stateRef,
      stateKey,
    });
  };
}

/** Pull the collection id out of any spec form for the public handle. */
function resolveCollectionId(
  collectionConfig: TaskBoardConfig<unknown, unknown>["collection"]
): string {
  if (isFactoryFn(collectionConfig)) return "factory-supplied";
  return collectionConfig.collectionId;
}

/**
 * Synthesize a stable per-worker id from the runtime ctx. The worker
 * sequencer's instance id includes the parent forEach index, so the
 * tag is unique per worker for the request's lifetime.
 *
 * Falls back to a board-prefixed default when the ctx lacks identity
 * information (test contexts, etc).
 */
function resolveWorkerIdFromCtx(ctx: BlockContext, boardName: string): string {
  const identity = (ctx as { _blockIdentity?: { blockInstanceId?: string } })
    ._blockIdentity;
  const instanceId = identity?.blockInstanceId;
  if (instanceId !== undefined && instanceId.length > 0) return instanceId;
  return `${boardName}-worker`;
}
