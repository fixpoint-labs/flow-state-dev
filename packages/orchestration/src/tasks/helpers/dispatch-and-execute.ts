/**
 * `dispatchAndExecuteBlock` — the canonical "claim one, execute it,
 * record the result" inner step shared by every task-shaped pattern
 * (FIX-443 §7).
 *
 * Pipeline performed when the produced block runs:
 *   1. `dispatcher.claim(collection, workerId, ctx)`
 *   2. If null → return `{ claimed: false }` (caller's loop should exit
 *      or back off).
 *   3. Pack the task into `TaskWorkerInput`, look up the worker from
 *      the registry (or use the uniform worker), invoke the worker via
 *      `asRuntime(worker).run`.
 *   4. On success → `collection.complete(taskId, output)`.
 *   5. On throw → `collection.fail(taskId, message)` and (per the
 *      `onError` policy) either swallow or rethrow.
 *
 * BP-011 deviation (FIX-503): the produced block is a `handler` whose
 * execute reaches through `asRuntime(worker).run` to dispatch the worker
 * directly. A sibling-sequencer composition would require static
 * knowledge of the worker at build time, but the worker is selected at
 * claim time from `task.assignee` against a registry. Using a
 * router-by-assignee inside a sequencer is feasible only when the
 * registry is fully enumerated up front; the substrate cast keeps the
 * helper compatible with both the uniform-worker and registry shapes
 * without forcing patterns to pre-declare every worker.
 */
import { composeSideChainSignal, handler } from "@flow-state-dev/core";
import { asRuntime, type BlockContext, type BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { ticketForClaim } from "../claim-ticket";
import { startLeaseRenewal } from "../lease-renewal";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import { advisoryComplete, advisoryFail } from "../collection/advisory-write-back";
import type { TaskDispatcher } from "../dispatchers/types";
import type { TaskWorker, TaskWorkerInput, TaskWorkerRegistry } from "../workers/types";

export interface DispatchAndExecuteOptions {
  collection: TaskCollectionRef;
  dispatcher: TaskDispatcher;
  /** Single uniform worker, OR a registry keyed by `task.assignee`. */
  workers: TaskWorker | TaskWorkerRegistry;
  /**
   * Worker id for trace attribution. Most patterns hand a stable
   * `worker-${index}` from a forEach. Default: `"worker"`.
   */
  workerId?: string;
  /**
   * Failure policy. Default: `"skip"` — capture the error on the
   * task via `fail` and return; siblings continue. `"fail"` rethrows
   * after `fail` so the parent sequencer fails, too.
   */
  onError?: "skip" | "fail";
  /**
   * Optional name override. Default: `"dispatch-and-execute"`. Useful
   * when a pattern uses the helper multiple times in the same sequencer
   * and needs distinct trace identities.
   */
  name?: string;
}

export interface DispatchAndExecuteResult<TOut = unknown> {
  /** True when a task was claimed and executed (regardless of success). */
  claimed: boolean;
  /** Claimed task id when `claimed === true`. */
  taskId?: string;
  /** Worker output when execution succeeded. */
  output?: TOut;
  /** Error message when execution failed and `onError: "skip"` swallowed it. */
  error?: string;
}

/**
 * A `BlockDefinition` exposes a callable substrate dispatch entry point;
 * a registry is a plain record of named blocks. Discriminate on `run`
 * rather than on `kind`-key presence — the latter would misroute a
 * registry that happens to use `"kind"` as an assignee key.
 */
function isUniformWorker(
  workers: TaskWorker | TaskWorkerRegistry
): workers is TaskWorker {
  return typeof (workers as { run?: unknown }).run === "function";
}

function resolveWorker(
  workers: TaskWorker | TaskWorkerRegistry,
  task: Task
): TaskWorker {
  if (isUniformWorker(workers)) return workers;

  const assignee = task.assignee;
  if (assignee === undefined) {
    throw new Error(
      `[tasks] dispatchAndExecute: task "${task.id}" has no assignee, but a worker registry was supplied`
    );
  }
  // BP-031: `assignee` is model-controllable (from the `addTask` tool), so an
  // `in`/`[]` lookup against the plain-object registry could resolve inherited
  // `Object.prototype` members (e.g. "constructor", "toString") instead of a
  // real worker. Require an own property before indexing (FIX-943).
  if (!Object.hasOwn(workers, assignee)) {
    throw new Error(
      `[tasks] dispatchAndExecute: no worker registered under assignee "${assignee}" for task "${task.id}"`
    );
  }
  return workers[assignee];
}

/**
 * Pack a `Task` into the substrate's `TaskWorkerInput` shape. When the
 * task declares `deps`, this resolves each dep's `output` from the
 * collection and exposes them under `deps: Record<depId, output>`.
 * Workers that need upstream context read `input.deps` directly.
 */
function packWorkerInput(
  task: Task,
  collection: TaskCollectionRef,
): TaskWorkerInput {
  // Note: the patterns-side `packWorkerInput` (in
  // `packages/patterns/src/task-board/blocks/worker-step.ts`) gained
  // optional flow-policy parameters in FIX-610. This helper-local copy
  // stays synchronous and dep-only — flow policy is a board concern, not
  // a free-function-helper concern.
  const deps: Record<string, unknown> = {};
  if (task.deps !== undefined) {
    for (const depId of task.deps) {
      const depTask = collection.get(depId);
      if (depTask !== undefined && depTask.output !== undefined) {
        deps[depId] = depTask.output;
      }
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
  };
}

/**
 * The context the worker runs under, carrying `signal` all the way down
 * (FIX-1005).
 *
 * Spreading `signal` onto a copy of `ctx` is necessary but **not sufficient**,
 * and the gap only shows on a composite worker. A spread copy sets the
 * worker's own `ctx.signal`, which is all a leaf handler ever reads. But a
 * sequencer worker dispatches its nested steps through `_withExecutionScope`,
 * and that function is a closure bound to the ORIGINAL context object — it
 * derives each child scope's signal from `context.signal`, the original's, not
 * from the copy it was invoked on. So every descendant of a composite worker
 * kept running under the request signal: a worker whose claim was displaced
 * mid-run would abort its outermost step and its generators would keep making
 * model calls underneath.
 *
 * Re-binding the closure to compose this signal into every child scope closes
 * it at one level, which is all it takes: the child scope's own `ctx.signal`
 * becomes the composed one, and the engine propagates from there.
 *
 * **An explicit override is composed with, never deferred to.** The background
 * forms — `.sideChain()`, `.sideChainIf()`, `.forEachSideChain()` — each pass the
 * request's background signal as an explicit `signalOverride`, and that signal
 * is deliberately decoupled from transport teardown (FIX-663) so background
 * work outlives a disconnected client. Taking the override *instead of* this
 * one would hand that decoupling to lease loss as well, which is a different
 * question with the opposite answer: a worker whose claim was displaced cannot
 * record anything it produces, so its background tasks are paying for output
 * the fence will refuse. Composing keeps both promises — the task still
 * survives transport teardown, and it still stops when the claim is gone.
 *
 * **The background signal is composed at its source too**, not only at this
 * closure. Composing here alone reaches a `.sideChain()` dispatched by the worker
 * itself and nothing deeper: the scope this closure builds hands descendants
 * the engine's own `_withExecutionScope`, and a background dispatch two levels
 * down substitutes the request's background signal again with this one nowhere
 * in it. Setting `_requestSideChainSignal` on the worker's context is what
 * makes it hold at any depth, because every scope now inherits that field from
 * its parent.
 *
 * **The two channels are fed different signals, and that is the whole point of
 * taking them as separate arguments.** `foreground` is the request's signal
 * composed with lease loss. Feeding *that* to the background channel would put
 * the transport signal into it, so a client disconnect would kill work that
 * exists precisely to outlive a disconnect (FIX-663) — trading one correct
 * behaviour for another. The background channel gets `leaseLost` raw, so a
 * background task stops when the claim is gone and not when the client hangs
 * up.
 *
 * A unit-test context installs no scope at all, and there the spread already is
 * the whole story — nested steps run on the context they were handed.
 */
function workerCtx(
  ctx: BlockContext,
  foreground: AbortSignal,
  leaseLost: AbortSignal
): BlockContext {
  const background = composeSideChainSignal(ctx, leaseLost);
  const withScope = ctx._withExecutionScope;
  const base: BlockContext =
    withScope === undefined
      ? { ...ctx, signal: foreground }
      : {
          ...ctx,
          signal: foreground,
          _withExecutionScope: (parent, execute, signalOverride, sideChainOverride) => {
            // Which signal this scope must carry depends on what KIND of scope
            // it is, and `parent.phase` is the only thing that says so. A
            // background dispatch arrives here with the request's background
            // signal as its `signalOverride`; composing the foreground into
            // that would put the transport signal back into work that exists
            // to outlive transport teardown. So a `"sideChain"` scope is composed
            // with the raw lease signal and a main scope with the foreground.
            const isSideChain = parent.phase === "sideChain";
            const extra = isSideChain ? leaseLost : foreground;
            return withScope.call(
              ctx,
              parent,
              execute,
              signalOverride === undefined
                ? extra
                : AbortSignal.any([signalOverride, extra]),
              sideChainOverride === undefined
                ? background
                : AbortSignal.any([sideChainOverride, leaseLost])
            );
          },
        };
  if (background !== undefined) {
    (base as { _requestSideChainSignal?: AbortSignal })._requestSideChainSignal =
      background;
  }
  return base;
}

/**
 * Build a block that performs one claim → execute → record cycle.
 * Patterns compose this via `.step(dispatchAndExecuteBlock(...))` in
 * their own sequencer chains. Replaces the pre-FIX-503 free-function
 * helper that callers invoked from inside their own handler bodies
 * (BP-011 violation).
 */
export function dispatchAndExecuteBlock<TOut = unknown>(
  options: DispatchAndExecuteOptions
): BlockDefinition {
  const workerId = options.workerId ?? "worker";
  const onError = options.onError ?? "skip";
  const name = options.name ?? "dispatch-and-execute";

  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.object({
      claimed: z.boolean(),
      taskId: z.string().optional(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (_input, ctx: BlockContext): Promise<DispatchAndExecuteResult<TOut>> => {
      const claimed = await options.dispatcher.claim(options.collection, workerId, ctx);
      if (claimed === null) {
        return { claimed: false };
      }

      const worker = resolveWorker(options.workers, claimed);
      const workerInput = packWorkerInput(claimed, options.collection);
      // Minted from the claim the substrate just committed, never assembled by
      // hand (FIX-981). `claimed` is post-claim, so its `attempts` is this
      // cycle's attempt number.
      const claim = ticketForClaim(options.collection.collectionId, claimed);

      // Renewal spans the worker's execution **and the write that records its
      // result** (FIX-1005). Stopping when the run returns would be a boundary
      // error in the expensive direction: `complete()` and `fail()` are fenced
      // on this ticket, so a lease that lapses between the last renewal and the
      // write makes the substrate refuse a *healthy* worker's result. The task
      // is then handed to someone else and every side effect this worker
      // already committed happens again — which is the duplicate work the lease
      // exists to prevent, caused by the mechanism meant to prevent it.
      //
      // A renewal in flight across the settlement is harmless in the other
      // direction: it writes only `leaseUntil`, and once the row is settled the
      // fence declines it and the driver stops itself.
      const renewal = startLeaseRenewal({
        collection: options.collection,
        ticket: claim,
        claimedTask: claimed,
        signal: ctx.signal,
      });
      try {
        // BP-011 deviation (FIX-503): the worker is selected dynamically from
        // `task.assignee`, so it can't be wired into a static sibling-step
        // sequencer composition. `asRuntime(worker).run` is the sanctioned
        // substrate cast for first-party dispatch.
        //
        // Composed, never substituted — the worker must still stop when the
        // request is cancelled, not only when the claim is lost.
        const foreground =
          ctx.signal === undefined
            ? renewal.signal
            : AbortSignal.any([ctx.signal, renewal.signal]);
        const output = (await asRuntime(worker).run(
          workerInput,
          // The raw lease signal is handed over separately, not folded into
          // `foreground` — background work must stop on lease loss without
          // inheriting the transport signal `foreground` carries.
          workerCtx(ctx, foreground, renewal.signal)
        )) as TOut;
        // Advisory write-back (FIX-951): the task may have been settled or
        // handed to another worker while this one ran.
        await advisoryComplete(options.collection, claimed.id, output, {
          ifAllowed: true,
          claim,
        });
        return { claimed: true, taskId: claimed.id, output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await advisoryFail(options.collection, claimed.id, message, {
          ifAllowed: true,
          claim,
        });
        if (onError === "fail") throw err;
        return { claimed: true, taskId: claimed.id, error: message };
      } finally {
        renewal.stop();
      }
    },
  });
}
