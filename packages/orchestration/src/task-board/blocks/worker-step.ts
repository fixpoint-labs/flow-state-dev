/**
 * Build the per-iteration worker step for the Task Board pipeline.
 *
 * The worker step takes a `Task` (piped from `claimTask` via the
 * pipeline's `.stepIf` connector) and produces whatever the worker
 * returns. The worker block runs as a first-class step in the
 * sequencer — it is NOT invoked from inside another block's `execute`
 * (BP-011). The pipeline composes it directly via `.step(workerStep)`.
 *
 * Two shapes:
 *
 * - **Uniform worker.** The user supplies a single block. We pre-
 *   connect it with a connector that adapts `Task → TaskWorkerInput`,
 *   yielding a block whose input is a `Task`. Pre-connecting is
 *   appropriate per BP-013 because this adaptation is purpose-built
 *   for the pattern (the input contract belongs to the pattern, not
 *   to a runtime route choice).
 *
 * - **Worker registry.** The user supplies `Record<assignee, block>`.
 *   We pre-connect each worker with the `Task → TaskWorkerInput`
 *   adaptation (BP-013: pre-connecting at definition time is fine for
 *   purpose-built pattern adapters) and feed the registry to
 *   `utility.keyedRouter`, which dispatches by `task.assignee`. The
 *   workers themselves keep their generic `TaskWorkerInput` schema
 *   and stay reusable; only their pattern-side registry entry is
 *   pre-adapted.
 *
 * Registry-miss handling depends on whether a `defaultWorker` is
 * configured. Without one, a miss (unknown assignee, or no assignee on
 * the task) throws out of the router; the error propagates up through
 * the sequencer's `.rescue()` to `recordError`, which writes
 * `collection.fail` against the worker's per-state `currentTaskId` —
 * exactly the offending task, never a sibling's concurrently-claimed
 * work. With a `defaultWorker`, a miss instead routes to that worker
 * via the `keyedRouter` `fallback` slot (FIX-940): an unknown assignee
 * falls through natively (no entry under that key), and an *absent*
 * assignee is steered to the fallback through a reserved sentinel route
 * (the one case `keyedRouter` can't infer, since `select` must return a
 * string).
 */
import { utility } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  taskSchema,
  type Task,
  type TaskCollectionRef,
  type TaskWorker,
  type TaskWorkerInput,
  type TaskWorkerRegistry,
} from "../../tasks";

/**
 * True when `workers` is a single block (carries the substrate `run`
 * dispatch entry) rather than a record of blocks. Discriminates on
 * `run` not on key presence so a registry that happens to have a key
 * called `"run"` doesn't misroute. Updated for FIX-503 — the public
 * `BlockDefinition.run` was removed in favour of `BlockRuntime.run`.
 */
export function isUniformWorker(
  workers: TaskWorker | TaskWorkerRegistry
): workers is TaskWorker {
  return typeof (workers as { run?: unknown }).run === "function";
}

/**
 * Pack a `Task` into the substrate's `TaskWorkerInput` shape. When the
 * task declares `deps`, this resolves each dep's `output` from the
 * collection and exposes them under `deps: Record<depId, output>` so
 * the worker can read upstream context via `input.deps`.
 *
 * When a `flowPolicy` + active ledger view are supplied (FIX-610
 * Layer A), the policy is consulted to select a `priorWork` slice and
 * stamped on the worker input. The optional `ctx` is forwarded to the
 * policy's `select` so policies that need request/session state can
 * read it. Back-compat: omitting the new parameters yields a
 * `TaskWorkerInput` with no `priorWork` field — wire-identical to
 * pre-FIX-610 boards.
 */
export async function packWorkerInput(
  task: Task,
  collection: TaskCollectionRef,
  opts?: {
    ctx?: BlockContext;
    flowPolicy?: {
      name: string;
      select: (args: {
        task: Task;
        ledger: unknown;
        collection: TaskCollectionRef;
        ctx: BlockContext;
      }) => unknown | Promise<unknown>;
    };
    ledger?: unknown;
  },
): Promise<TaskWorkerInput> {
  const deps: Record<string, unknown> = {};
  if (task.deps !== undefined) {
    for (const depId of task.deps) {
      const depTask = collection.get(depId);
      if (depTask !== undefined && depTask.output !== undefined) {
        deps[depId] = depTask.output;
      }
    }
  }

  let priorWork: unknown;
  if (opts?.flowPolicy !== undefined && opts.ledger !== undefined && opts.ctx !== undefined) {
    const selected = await opts.flowPolicy.select({
      task,
      ledger: opts.ledger,
      collection,
      ctx: opts.ctx,
    });
    const obs = (selected as { observations?: unknown[]; narrative?: string } | undefined)
      ?.observations;
    const narrative = (selected as { narrative?: string } | undefined)?.narrative;
    if ((Array.isArray(obs) && obs.length > 0) || (typeof narrative === "string" && narrative.length > 0)) {
      priorWork = selected;
    }
  }

  return {
    taskId: task.id,
    goal: task.goal,
    ...(task.title !== undefined ? { title: task.title } : {}),
    ...(task.context !== undefined ? { context: task.context } : {}),
    input: task.input,
    attempts: task.attempts,
    feedback: task.feedback,
    metadata: task.metadata,
    ...(Object.keys(deps).length > 0 ? { deps } : {}),
    ...(priorWork !== undefined ? { priorWork } : {}),
  };
}

/**
 * Reserved `select` return value that steers a task with **no** assignee
 * to the router's `fallback` (the default worker). It can never collide
 * with a real registry key: agent/assignee keys must match
 * `/^[a-z0-9][a-z0-9_-]*$/`, so a leading underscore is unrepresentable.
 * Only used when a `defaultWorker` is configured; without one an absent
 * assignee still throws (I2).
 */
const ABSENT_ASSIGNEE_ROUTE = "__no_assignee__";

export interface BuildWorkerStepOptions {
  /** Block-name prefix for the synthesised router (registry path only). */
  name: string;
  workers: TaskWorker | TaskWorkerRegistry;
  /**
   * Optional default worker (the delegation floor, FIX-940). Registry
   * path only: wired as the `keyedRouter` `fallback`, it runs any task
   * whose `assignee` is unknown or absent. Omit it and a registry miss
   * throws exactly as before (I2). Declared workers are never routed
   * through it — the floor is reached only on a genuine miss (I1/I3).
   */
  defaultWorker?: TaskWorker;
  /**
   * Resolves the active board's collection from a block context.
   * `packWorkerInput` calls this on every claim so dep outputs can be
   * materialized into `TaskWorkerInput.deps` from the live collection
   * state.
   */
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /**
   * Optional flow-policy resolver (FIX-610). When the resolver returns
   * a `{ flowPolicy, ledger }` pair, `packWorkerInput` stamps the
   * worker input's `priorWork` slot with the policy's selection.
   * Returning `undefined` skips the field entirely (back-compat).
   */
  resolveFlowPolicy?: (ctx: BlockContext) => {
    flowPolicy: {
      name: string;
      select: (args: {
        task: Task;
        ledger: unknown;
        collection: TaskCollectionRef;
        ctx: BlockContext;
      }) => unknown | Promise<unknown>;
    };
    ledger: unknown;
  } | undefined;
}

/**
 * Returns a block that takes a `Task` and produces the worker's
 * output. For uniform workers the result is the worker pre-connected
 * with `Task → TaskWorkerInput`. For registries the result is a
 * `utility.keyedRouter` over each worker pre-connected with the same
 * adaptation, selecting by `task.assignee`.
 *
 * The output type is `unknown` because worker outputs are
 * heterogeneous; consumers that need a typed shape should use the
 * uniform-worker path with a worker that declares its own
 * `outputSchema`. Registry workers are typed as
 * `BlockDefinition<any, any>` — each can declare its own
 * input/output schemas, and the router's static type can't model
 * that union usefully (matches the convention used by
 * `dispatch-specialist` in the blackboard pattern).
 */
export function buildWorkerStep(
  options: BuildWorkerStepOptions
) {
  const { name, workers, collection: collectionFactory, resolveFlowPolicy, defaultWorker } = options;

  const packOpts = (ctx: BlockContext) => {
    if (resolveFlowPolicy === undefined) return { ctx };
    const resolved = resolveFlowPolicy(ctx);
    return resolved === undefined
      ? { ctx }
      : { ctx, flowPolicy: resolved.flowPolicy, ledger: resolved.ledger };
  };

  if (isUniformWorker(workers)) {
    return workers.connectInput<Task>(async (task, ctx) =>
      packWorkerInput(task, await collectionFactory(ctx), packOpts(ctx))
    );
  }

  // Pre-connect each worker so the router doesn't have to thread the
  // adaptation through its `select`. The connectInput closure captures
  // the inbound `task` so dep-output resolution happens at runtime
  // against the live collection state.
  const connectedWorkers: Record<string, BlockDefinition<any, any>> = {};
  for (const [assignee, worker] of Object.entries(workers)) {
    connectedWorkers[assignee] = worker.connectInput<Task>(async (task, ctx) =>
      packWorkerInput(task, await collectionFactory(ctx), packOpts(ctx))
    );
  }

  // Pre-connect the default worker with the SAME Task → TaskWorkerInput
  // adaptation the registry entries get, so a floor-routed task carries
  // deps/priorWork identically. Passed as the router `fallback` (FIX-940).
  const connectedFallback =
    defaultWorker !== undefined
      ? defaultWorker.connectInput<Task>(async (task, ctx) =>
          packWorkerInput(task, await collectionFactory(ctx), packOpts(ctx))
        )
      : undefined;

  return utility.keyedRouter({
    name: `${name}-worker-router`,
    inputSchema: taskSchema,
    outputSchema: z.unknown(),
    blocks: connectedWorkers,
    ...(connectedFallback !== undefined ? { fallback: connectedFallback } : {}),
    select: (task: Task) => {
      if (task.assignee === undefined) {
        // A present-but-unknown assignee routes to `fallback` natively;
        // an absent one has no key, so steer it explicitly — but only
        // when a floor exists. With no floor, keep throwing (I2).
        if (connectedFallback !== undefined) return ABSENT_ASSIGNEE_ROUTE;
        throw new Error(
          `[task-board] task "${task.id}" has no assignee, but a worker registry was supplied`
        );
      }
      return task.assignee;
    },
  });
}
