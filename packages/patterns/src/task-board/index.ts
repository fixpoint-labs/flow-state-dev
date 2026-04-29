/**
 * Task Board Pattern (FIX-446)
 *
 * Concurrent drain over a `TaskCollection` with dependency gating and
 * per-task worker routing. The unified Plan/Task primitive's canonical
 * validation case: the dispatch is CAS-safe, workers are routed by
 * `task.assignee`, mid-drain enqueues are picked up automatically, and
 * `awaiting_review` is correctly handled (skip + wait) for the HITL
 * forward-compat surface that ships in Wave 2.
 *
 * ## Pipeline shape
 *
 *   [seedCollection?] → forEach(workerId, makeWorker)
 *
 *   makeWorker:
 *     [claimAndExecute] → [checkBoard] → loopBack(claimAndExecute, when=shouldContinue)
 *
 *   claimAndExecute is implemented with the substrate's `dispatchAndExecute`
 *   helper — a single function call that does claim → run → record. The
 *   four exposed remix blocks (`selectNextReadyTask`, `claimTask`,
 *   `runWorker`, `recordResult`) are individually composable for
 *   consumers who need a different inner shape.
 *
 * ## Termination
 *
 *   - `onIdle: 'complete'` (default): exit when no `pending`,
 *     `in_progress`, or `awaiting_review` tasks remain. `awaiting_review`
 *     keeps the loop alive — workers idle-poll until an external actor
 *     transitions the task out.
 *
 *   - `onIdle: 'wait'`: never exit on drained-ness. Defer to the
 *     `shouldExit` predicate; the loop runs until `shouldExit` returns
 *     `true` or `maxIterations` trips.
 *
 * ## CAS-safe dispatch
 *
 * The substrate's `collection.claim` runs eligibility scan + CAS flip
 * inside one mutator pass; under contention, exactly one worker wins
 * and the other immediately re-scans for the next eligible task. No
 * pattern-level coordination beyond that.
 *
 * ## Layering
 *
 * Lives in `@flow-state-dev/patterns`. Depends on
 * `@flow-state-dev/tasks` for the substrate (Task, TaskCollectionRef,
 * dispatchers, helpers). Never imports from `react`, `client`, or
 * `server`.
 */
import { sequencer } from "@flow-state-dev/core";
import type { SequencerDefinition } from "@flow-state-dev/core";
import type { BlockContext, StateRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  dispatchAndExecute,
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskInit,
  type TaskWorker,
  type TaskWorkerRegistry,
} from "@flow-state-dev/tasks";
import { handler } from "@flow-state-dev/core";

import { taskBoardStateSchema, taskBoardWorkerStateSchema } from "./schemas";
import { resolveDispatcher, type TaskBoardDispatcherInput } from "./shared";
import { createSeedCollection } from "./blocks/seed-collection";
import { createSelectNextReadyTask } from "./blocks/select-next-ready-task";
import { createClaimTask } from "./blocks/claim-task";
import { createRunWorker } from "./blocks/run-worker";
import { createRecordResult } from "./blocks/record-result";
import { createCheckBoard } from "./blocks/check-board";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { taskBoardStateSchema, taskBoardWorkerStateSchema } from "./schemas";
export type { TaskBoardState, TaskBoardWorkerState } from "./schemas";
export type { TaskBoardDispatcherInput } from "./shared";
export { createSeedCollection } from "./blocks/seed-collection";
export { createSelectNextReadyTask } from "./blocks/select-next-ready-task";
export type {
  SelectNextReadyTaskOptions,
  SelectNextReadyTaskOutput,
} from "./blocks/select-next-ready-task";
export { createClaimTask } from "./blocks/claim-task";
export type { ClaimTaskOptions, ClaimTaskOutput } from "./blocks/claim-task";
export { createRunWorker } from "./blocks/run-worker";
export type {
  RunWorkerOptions,
  RunWorkerInput,
  RunWorkerOutput,
} from "./blocks/run-worker";
export { createRecordResult } from "./blocks/record-result";
export type {
  RecordResultOptions,
  RecordResultInput,
  RecordResultOutput,
} from "./blocks/record-result";
export { createCheckBoard } from "./blocks/check-board";
export type {
  CheckBoardOptions,
  CheckBoardInput,
  CheckBoardOutput,
} from "./blocks/check-board";

// ---------------------------------------------------------------------------
// Public config / handle
// ---------------------------------------------------------------------------

/**
 * Sequencer-state-backed collection spec. The pattern wires
 * `getOrCreateTaskCollection({ backing: "sequencer", sequencer:
 * ctx.sequencer })` at runtime; the outer sequencer's `stateSchema`
 * must include a record at `[stateKey]` (default `"tasks"`).
 *
 * The default `taskBoardStateSchema` exported from this module already
 * declares the canonical shape — pass it directly when defining the
 * outer sequencer, or extend it with your own keys.
 */
export interface TaskBoardSequencerCollectionSpec {
  backing?: "sequencer";
  collectionId: string;
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
   * Where the collection lives. Either a sequencer-state spec (the
   * default backing) or a caller-supplied factory `(ctx) => collection`
   * for advanced cases (resource-backed collections, externally
   * managed collections, etc).
   */
  collection:
    | TaskBoardSequencerCollectionSpec
    | TaskBoardCollectionFactory<TInput, TOutput>;

  /**
   * Worker(s) to dispatch tasks to. A single uniform worker runs every
   * claimed task; a registry routes by `task.assignee`. Workers are
   * standard `BlockDefinition`s wrapping the substrate's
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
   *
   * Custom dispatchers must satisfy the substrate's `TaskDispatcher`
   * contract (claim returns `Task | null`, CAS-safe).
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

  /** Tasks seeded into the collection at pool start. Optional. */
  initialTasks?: readonly TaskInit<TInput>[];

  /**
   * Worker-failure policy. Default: `"skip"`.
   * - `"skip"`: capture error on the task via `fail`, log; siblings
   *   continue.
   * - `"fail"`: propagate the error; the parent sequencer fails.
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
}

export interface TaskBoardHandle {
  /**
   * The composed sequencer block. Plug into a parent flow or
   * sequencer.
   *
   * For the sequencer-backed default, the parent sequencer's
   * `stateSchema` MUST include a `Record<string, Task>` slot at
   * `[stateKey]` (default `"tasks"`) — `taskBoardStateSchema` is the
   * canonical shape.
   */
  block: SequencerDefinition<any, any>;
  /** Stable identifier for the collection — matches `task_change.collectionId`. */
  collectionId: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a Task Board pattern instance. See module doc for the pipeline
 * semantics and termination rules.
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
    collection: collectionFactory as (
      ctx: BlockContext
    ) => TaskCollectionRef<TInput, unknown>,
    initialTasks,
  });

  // Inner step: claim → run → record. Implemented via the substrate's
  // `dispatchAndExecute` helper for atomicity — one function call
  // surfaces the correct CAS / rescue semantics. The four individual
  // remix blocks above are exported for consumers that want a
  // different inner shape.
  //
  // Note: registry-miss errors (a task whose `assignee` has no
  // matching worker) throw out of `dispatchAndExecute` BEFORE the
  // try/catch around `worker.run`. We catch those here and convert
  // them to a `fail` on the task, honoring the configured `onError`
  // policy — otherwise a single mis-routed task would crash the loop.
  const claimAndExecuteStepName = `${name}-worker-claim-and-execute`;
  const claimAndExecute = handler({
    name: claimAndExecuteStepName,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      const collection = collectionFactory(ctx);
      const workerId = resolveWorkerIdFromCtx(ctx, name);
      try {
        return await dispatchAndExecute(
          { collection, dispatcher, workers, workerId, onError },
          ctx
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const inProgress = collection.list({ status: "in_progress" });
        for (const task of inProgress) {
          await collection.fail(task.id, message);
        }
        if (onError === "fail") throw err;
        return { claimed: true, error: message };
      }
    },
  });

  const checkBoard = createCheckBoard({
    name: `${name}-worker-check-board`,
    collection: collectionFactory,
    onIdle,
    idlePollMs,
    shouldExit,
  });

  function makeWorker(workerId: number): SequencerDefinition<any, any> {
    return sequencer({
      name: `${name}-worker-${workerId}`,
      stateSchema: taskBoardWorkerStateSchema,
    })
      .then(claimAndExecute)
      .then(checkBoard)
      .loopBack(claimAndExecuteStepName, {
        when: (v: unknown) =>
          (v as { shouldContinue?: boolean }).shouldContinue === true,
        maxIterations,
      }) as SequencerDefinition<any, any>;
  }

  const block = sequencer({
    name,
    stateSchema: taskBoardStateSchema,
  })
    .then(seedBlock)
    .forEach(
      () => Array.from({ length: concurrency }, (_, i) => i),
      (workerId: number) => makeWorker(workerId),
      { maxConcurrency: concurrency }
    ) as SequencerDefinition<any, any>;

  return { block, collectionId };
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
 * Build the runtime collection factory. Sequencer-backed specs go
 * through `getOrCreateTaskCollection({ backing: "sequencer", ... })`
 * which wires the emission frame from `ctx`. Caller-supplied factories
 * pass through unchanged.
 *
 * The factory resolves the board's `StateRef` via `ctx.getTarget(boardName)`
 * so workers spawned inside `.forEach` (whose `ctx.sequencer` points at
 * their own nested worker-state) still address the shared task record on
 * the outer board sequencer. Falls back to `ctx.sequencer` for top-level
 * callers (e.g., the seed block running directly under the board).
 */
function buildCollectionFactory<TInput, TOutput>(
  boardName: string,
  collectionConfig: TaskBoardConfig<TInput, TOutput>["collection"]
): (ctx: BlockContext) => TaskCollectionRef<TInput, TOutput> {
  if (isFactoryFn(collectionConfig)) return collectionConfig;

  const { collectionId, stateKey } = collectionConfig;
  return (ctx: BlockContext) => {
    const target = ctx.getTarget<Record<string, unknown>>(boardName);
    const sequencer = (target ?? ctx.sequencer) as
      | StateRef<Record<string, unknown>>
      | undefined;
    if (sequencer === undefined) {
      throw new Error(
        `[task-board] sequencer-backed collection "${collectionId}" requires either ctx.getTarget("${boardName}") or ctx.sequencer — call this block inside the board sequencer`
      );
    }
    return getOrCreateTaskCollection<TInput, TOutput>({
      ctx,
      backing: "sequencer",
      collectionId,
      sequencer,
      stateKey,
    });
  };
}

/** Pull the collection id out of either spec form for the public handle. */
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
