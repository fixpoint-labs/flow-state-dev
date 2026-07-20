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
 *   `.step(claimTask)
 *      .stepIf(claimed, claim → task, workerBody)
 *      .step(checkBoard)
 *      .loopBack(claimTask, when=shouldContinue)`
 *
 * `workerBody`:
 *   `.step(workerStep) .tap(recordSuccess) .rescue(recordError)`
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
 * - `onIdle: 'complete-or-blocked'` (default, FIX-626): exit when the
 *   collection drains, OR when no active worker is in-flight and no
 *   `pending` task is claimable (every remaining pending has a
 *   non-`completed` dep). Handles the DAG case where an upstream task
 *   errors and downstream pendings can never run. The final
 *   `task-board-meta` item carries `terminationReason:
 *   "all-completed" | "blocked-by-failures"` so callers can tell the
 *   two outcomes apart without inspecting `counts`.
 *
 * - `onIdle: 'complete'`: exit only when no `pending`, `in_progress`,
 *   or `awaiting_review` tasks remain. Legacy default. Use when a
 *   pending task with a non-completed dep is a transient state an
 *   external pump will eventually resolve.
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
import { sequencer, defineCapability } from "@flow-state-dev/core";
import { z } from "zod";
import { whenBoardClaimable } from "./predicates";
import type { DefinedCapability, SequencerDefinition } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  BlockContext,
  MaybePromise,
  StateRef,
} from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  isDefinedTaskCollection,
  onTaskChangeFor,
  type DefinedTaskCollection,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorker,
  type TaskWorkerRegistry,
} from "../tasks";
import {
  createTaskBoardCapability,
  type TaskBoardCapabilityAccessor,
} from "./capability";
import { resolveResourceTaskCollection } from "./resolve-resource";

import {
  taskBoardStateSchema,
  taskBoardWorkerStateSchema,
  taskBoardWorkerBodyStateSchema,
  claimResultSchema,
  type ClaimResult,
} from "./schemas";
import type { Task } from "../tasks";
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
export { createCascadeSkipDependents } from "./blocks/cascade-skip-dependents";
export type { CascadeSkipDependentsOptions } from "./blocks/cascade-skip-dependents";
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
 * Request-scoped collection spec — the **default** backing.
 *
 * Tasks live on `ctx.request` so the collection survives every block boundary,
 * including multiple invocations of `board.drain` from a parent sequencer's
 * outer loop and adds from a sibling or outer step *before* the board drains.
 * Both `backing` and `collectionId` are optional: an omitted `collection` (or an
 * object with neither field) is request-backed with `collectionId` defaulting to
 * the board `name`.
 *
 * The capability built for this backing does NOT declare `targetStateSchemas`
 * and reaches the collection from any block in the request, not just blocks
 * under `board.drain`'s subtree.
 */
export interface TaskBoardRequestCollectionSpec {
  backing?: "request";
  /** Stable collection id. Defaults to the board `name`. */
  collectionId?: string;
  /**
   * Top-level field on `ctx.request.state` holding the `Record<id, Task>`.
   * Defaults to `collectionId` so multiple boards in one request stay
   * namespaced without manual setup.
   */
  stateKey?: string;
}

/**
 * Sequencer-state-backed collection spec — explicit opt-in. Wires
 * `getOrCreateTaskCollection({ backing: "sequencer", sequencer:
 * <board-state-ref> })` at runtime. The outer sequencer's `stateSchema` must
 * include a `Record<string, Task>` slot at `[stateKey]` (default `"tasks"`) —
 * `taskBoardStateSchema` is the canonical shape.
 *
 * Single-invocation only: sequencer state is per-invocation and won't survive
 * across `board.drain` calls. For re-entry across an outer loop, use the default
 * request backing; for a board whose tasks outlive the request, use a
 * `DefinedTaskCollection` (`defineTaskCollection`).
 */
export interface TaskBoardSequencerCollectionSpec {
  backing: "sequencer";
  collectionId: string;
  stateKey?: string;
}

/** Caller-supplied factory — full control. Receives the worker's `BlockContext`. */
export type TaskBoardCollectionFactory<TInput, TOutput> = (
  ctx: BlockContext
) => MaybePromise<TaskCollectionRef<TInput, TOutput>>;

export interface TaskBoardConfig<TInput = unknown, TOutput = unknown> {
  /**
   * Name for this task board. Used as the outer sequencer name and as a
   * prefix for every internal block name (must be globally unique inside
   * a flow if you have multiple boards).
   */
  name: string;

  /**
   * Where the collection lives — a once-chosen internal detail. Optional; an
   * omitted collection is request-backed with `collectionId` = `name`. One of:
   *
   * - `TaskBoardRequestCollectionSpec` (**default**) — tasks on `ctx.request`.
   *   Survives re-entry across `board.drain` invocations and adds from sibling
   *   or outer steps before the drain. Omit `collection` entirely to get this.
   * - `DefinedTaskCollection` (`defineTaskCollection`) — durable, resource-backed
   *   tasks that outlive the request. The board registers and resolves it for
   *   you; consumers touch only `board.capability`.
   * - `TaskBoardSequencerCollectionSpec` — explicit opt-in; tasks on the board's
   *   own sequencer state. Single-invocation; per-call state.
   * - `TaskBoardCollectionFactory<TInput, TOutput>` — caller-supplied
   *   `(ctx) => collection` for externally-managed / custom stores.
   */
  collection?:
    | TaskBoardRequestCollectionSpec
    | TaskBoardSequencerCollectionSpec
    | DefinedTaskCollection
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
   * - `"complete-or-blocked"` (default, FIX-626): exit when the
   *   collection drains, OR when no in-flight worker is active and no
   *   `pending` task is claimable. The final `task-board-meta` item's
   *   `terminationReason` field distinguishes `"all-completed"` from
   *   `"blocked-by-failures"`.
   * - `"complete"`: exit only when no `pending`, `in_progress`, or
   *   `awaiting_review` tasks remain. Pre-FIX-626 default; preserved
   *   for boards that wait on an external pump to mark deps complete.
   * - `"wait"`: never auto-exit; defer to `shouldExit`. Long-running
   *   session-scoped boards.
   */
  onIdle?: "wait" | "complete" | "complete-or-blocked";

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
   * `onIdle: 'complete'` and `onIdle: 'complete-or-blocked'` modes.
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
   * Per-board flow policy. Decides which prior-task observations a
   * soon-to-dispatch worker sees on `TaskWorkerInput.priorWork`.
   * Default: `flowPolicy.declaredDepsOnly()`. Pattern factories like
   * `planAndExecute` pin richer defaults (`recentTrajectory({ n: 8 })`).
   */
  flowPolicy?: import("../tasks").TaskFlowPolicy;
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
   * The composed drain sequencer — the block that runs the board's
   * tasks. Plug into a parent flow or sequencer.
   *
   * For the sequencer-backed default, the parent sequencer's
   * `stateSchema` MUST include a `Record<string, Task>` slot at
   * `[stateKey]` (default `"tasks"`). `taskBoardStateSchema` declares
   * the canonical shape.
   */
  drain: SequencerDefinition<any, any>;
  /** Stable identifier for the collection — matches `data.collectionId` on emitted `task-change` items. */
  collectionId: string;
  /**
   * Capability exposing the board's tasks at `ctx.cap.<name>` (the board name
   * verbatim; hyphenated names via bracket access, e.g. `ctx.cap["my-board"]`).
   * Add to any block's `uses` array and call the sugar directly —
   * `ctx.cap.<name>.addTask({...})`, `.listTasks(...)`, `.tasks()` for the full
   * ref.
   *
   * Backing-aware: the request default (and resource backing) let sibling and
   * outer blocks read/mutate the board; the sequencer opt-in additionally
   * auto-declares the board's `tasks` slot via `targetStateSchemas` and throws
   * if used from outside the board's subtree (state must be in scope). Factory-
   * backed boards defer entirely to the user's factory.
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
    onIdle = "complete-or-blocked",
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
  const binding = resolveCollectionBinding<TInput, TOutput>(
    name,
    collectionConfig
  );
  const { collectionFactory, collectionId, capability, drainUses } = binding;

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
      // FIX-658: mark this worker-body scope so every item the worker emits
      // (messages, tool calls, sources, reasoning) is stamped with the task
      // id at emit time. This makes per-task attribution correct under
      // concurrent fan-out — a sibling worker's items no longer fall inside
      // this task's render window — and across sequential `loopBack` turns,
      // where the execution path repeats but each turn is a fresh scope.
      ctx._markTaskScope?.(task.id);
      // FIX-610: also stamp the active task id onto the shared
      // run-state bag so any cacheable tool the worker invokes attributes
      // cache writes to this task (later hits get `sourceTask`).
      stampCurrentTaskId(task);
    })
    .step(workerStep)
    .tap(recordSuccess)
    .rescue([{ block: recordError }]);

  function makeWorker(workerId: number) {
    // Per-worker mutable cell holding the resolved collection ref. The
    // `.waitForCondition` predicate signature is `(items) => boolean`
    // and does not receive a ctx, so we capture the ref via a leading
    // `.tap` step the first time this worker runs. Resolving once per
    // worker is fine: the collection factory is idempotent (same
    // collectionId → same ref) and avoids re-doing the lookup every
    // iteration. Predicate reads from `cell.collection!` — guaranteed
    // populated because the tap runs before the wait.
    const cell: {
      collection?: TaskCollectionRef;
      wakeFilter?: (item: OutputItem) => boolean;
    } = {};

    const idleWait = sequencer({
      name: `${name}-worker-${workerId}-idle-wait`,
      inputSchema: z.unknown(),
      // idleWait is the false-branch sibling of `claimTask`: both feed the
      // worker's `.stepIf((out: ClaimResult) => ...)` gates below, so its
      // terminal `.map` must produce a `ClaimResult`. The trailing `.map`
      // erases the tracked schema (so `.validate()` can't see it), so this
      // contract is enforced by the sequencer's runtime exit gate.
      outputSchema: claimResultSchema,
    })
      .tap(async (_input, ctx) => {
        if (cell.collection === undefined) {
          cell.collection = await collectionFactory(ctx);
          cell.wakeFilter = onTaskChangeFor(cell.collection.collectionId);
        }
      })
      .waitForCondition(
        (items) =>
          cell.collection === undefined
            ? false
            : whenBoardClaimable(cell.collection, { onIdle, shouldExit })(items),
        // Long timeout: a quiet board still wakes on task-change items.
        // The timeout is the upper bound on starvation if the wake
        // signal is somehow missed — the worker's outer `loopBack`
        // re-evaluates exit on every wake, so even a hard timeout
        // cycles cleanly back through `checkBoard`. Per spec §3.6,
        // scale to `idlePollMs * 100` so test boards with tiny poll
        // intervals still cycle quickly.
        //
        // `wakeOn` (FIX-660): fast-path the listener so transient
        // `resource_change` and `block_trace` items emitted by sibling
        // workers do not trigger a full collection scan. Without this
        // filter, a 16-worker `eventActors` board pays
        // `16 × collection.list()` per workspace patchState — visible
        // as multi-second idle gaps. `cell.collection` is guaranteed
        // populated by the leading `.tap`.
        {
          timeoutMs: Math.max(idlePollMs * 100, 50),
          // Defer to the cell because `cell.wakeFilter` is only known
          // after the leading `.tap` resolves the collection at runtime.
          // The outer closure is stable; the inner call is one
          // indirection per fan-out event. Pre-tap (impossible by
          // construction, but typed-defensively) the filter is open
          // (`true`) so no signal is dropped before the cell populates.
          wakeOn: (item) =>
            cell.wakeFilter === undefined ? true : cell.wakeFilter(item),
        }
      )
      .map(() => ({ claimed: false, task: undefined as Task | undefined }));

    return sequencer({
      name: `${name}-worker-${workerId}`,
      stateSchema: taskBoardWorkerStateSchema,
    })
      .step(claimTask)
      .stepIf(
        (out: ClaimResult) => !out.claimed,
        () => undefined,
        idleWait
      )
      .stepIf(
        (out: ClaimResult) => out.claimed,
        // Connector: ClaimResult → Task (the workerStep's input).
        // `task` is guaranteed defined when claimed === true; the
        // non-null assertion is safe here.
        (out: ClaimResult) => out.task!,
        workerBody
      )
      .step(checkBoard)
      .loopBack(claimStepName, {
        when: (v) => (v as { shouldContinue?: boolean }).shouldContinue === true,
        maxIterations,
      });
  }

  const drain = sequencer({
    name,
    stateSchema: taskBoardStateSchema,
    // Resource-backed boards install the durable collection on the drain's
    // action tree via the internal resource-declaring capability, so the seed
    // and worker blocks can resolve it from `ctx.resources`.
    ...(drainUses !== undefined ? { uses: drainUses } : {}),
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

  // Capability, collectionId, and (for durable boards) the drain's resource
  // `uses` all come from `resolveCollectionBinding` — one place that maps the
  // once-chosen backing onto every downstream wiring, so no call site restates
  // it. `board.capability` is always defined; `uses: [board.capability]` gets a
  // typed `ctx.cap.<name>` accessor regardless of backing.
  return { drain, collectionId, capability };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Everything the board factory needs that depends on the once-chosen backing:
 * the runtime collection factory, the public `collectionId`, the accessor
 * capability, and (durable boards only) the extra `uses` the drain sequencer
 * must install to make the resource collection resolvable.
 */
interface CollectionBinding<TInput, TOutput> {
  collectionFactory: (
    ctx: BlockContext
  ) => Promise<TaskCollectionRef<TInput, TOutput>>;
  collectionId: string;
  capability: DefinedCapability<string, TaskBoardCapabilityAccessor>;
  drainUses?: readonly DefinedCapability[];
}

/**
 * Map the once-chosen `collection` config onto every backing-dependent wiring.
 * Five forms, resolved here so no call site restates the backing:
 *
 * - omitted / request spec (**default**) — `getOrCreateTaskCollection({ backing:
 *   "request" })`; `collectionId` defaults to the board name. Reachable from any
 *   block in the request (sibling adds, outer-loop re-entry).
 * - `DefinedTaskCollection` — durable resource backing. Registers the collection
 *   via an internal resource-declaring capability (distinct name) threaded onto
 *   both `board.capability`'s and the drain's `uses`; resolves from
 *   `ctx.resources`.
 * - sequencer spec — `getOrCreateTaskCollection({ backing: "sequencer" })`
 *   against `ctx.getTarget(boardName)` (falling back to `ctx.sequencer` for the
 *   top-level seed handler).
 * - factory — caller-supplied `(ctx) => collection`, passed through unchanged.
 */
function resolveCollectionBinding<TInput, TOutput>(
  boardName: string,
  collectionConfig: TaskBoardConfig<TInput, TOutput>["collection"]
): CollectionBinding<TInput, TOutput> {
  // 1. Caller-supplied factory. Sync-or-async, normalized via `Promise.resolve`.
  if (typeof collectionConfig === "function") {
    const userFactory = collectionConfig;
    const collectionId = "factory-supplied";
    return {
      collectionFactory: (ctx) => Promise.resolve(userFactory(ctx)),
      collectionId,
      capability: createTaskBoardCapability({
        backing: "factory",
        boardName,
        collectionId,
        factory: userFactory,
      }),
    };
  }

  // 2. Durable, resource-backed collection.
  if (isDefinedTaskCollection(collectionConfig)) {
    const definedCollection = collectionConfig;
    const resourceKey = definedCollection.__taskCollection.id;
    const collectionId = resourceKey;
    // Internal resource-declaring capability — named distinctly from the public
    // `ctx.cap.<name>` board cap so the two never collide in `flattenCapabilities`.
    const resourceCapability = defineCapability({
      name: `${boardName}__taskCollection`,
      resources: { [resourceKey]: definedCollection },
    });
    const collectionFactory = (ctx: BlockContext) =>
      resolveResourceTaskCollection<TInput, TOutput>(ctx, {
        boardName,
        resourceKey,
        collectionId,
      });
    return {
      collectionFactory,
      collectionId,
      capability: createTaskBoardCapability({
        backing: "resource",
        boardName,
        collectionId,
        resourceKey,
        resourceCapability,
      }),
      drainUses: [resourceCapability],
    };
  }

  // 3. Sequencer opt-in.
  if (collectionConfig !== undefined && collectionConfig.backing === "sequencer") {
    const { collectionId, stateKey } = collectionConfig;
    const collectionFactory = (ctx: BlockContext) => {
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
    return {
      collectionFactory,
      collectionId,
      capability: createTaskBoardCapability({
        backing: "sequencer",
        boardName,
        collectionId,
        stateKey,
      }),
    };
  }

  // 4. Request (default) — omitted collection, or a request spec. `collectionId`
  // defaults to the board name so an omitted collection needs no fields at all.
  const collectionId = collectionConfig?.collectionId ?? boardName;
  const stateKey = collectionConfig?.stateKey;
  const collectionFactory = (ctx: BlockContext) =>
    getOrCreateTaskCollection<TInput, TOutput>({
      ctx,
      backing: "request",
      collectionId,
      stateKey,
    });
  return {
    collectionFactory,
    collectionId,
    capability: createTaskBoardCapability({
      backing: "request",
      boardName,
      collectionId,
      stateKey,
    }),
  };
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
