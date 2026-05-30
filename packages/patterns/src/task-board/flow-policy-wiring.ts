/**
 * Task Board wiring for FIX-610 (Wave 1 tool-cache + Wave 2 flow policy).
 *
 * The board's outer sequencer fires `installBoardCacheAndLedger` at the
 * top of every run (before `seedCollection`), which constructs a fresh
 * per-run cache store and observation ledger and binds both onto the
 * active context. Worker sub-trees inherit the binding through
 * `ctx._resolveToolCacheStore` / `ctx._writeToolObservation`, so any
 * cacheable tool or generator running under the board sees them.
 *
 * The cleanup hook (`teardownBoardCacheAndLedger`) clears both on
 * board completion AND on error — the `.rescue()` branch on the outer
 * sequencer ensures the second case. Without that, a board run that
 * threw partway through would leak its run-scoped cache entries until
 * the per-request store fell off (still bounded, but ugly).
 *
 * The tool-cache primitive (in-memory store + capability) lives in
 * `@flow-state-dev/core` next to the substrate wrapping that consumes
 * it. The observation ledger + flow-policy selectors live in
 * `@flow-state-dev/tasks` — both shape `TaskWorkerInput.priorWork`,
 * which is a tasks-package concept.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  handler,
  createInMemoryToolCacheStore,
  type ToolCacheStore,
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  createObservationLedger,
  flowPolicy as builtinFlowPolicy,
  type ObservationLedger,
  type ObservationLedgerView,
  type Task,
  type TaskCollectionRef,
  type TaskFlowPolicy,
} from "@flow-state-dev/tasks";
import type { TaskBoardToolCacheConfig } from "./index";

/**
 * Slot names on the hidden `ctx.request` resolver bag — must stay in
 * sync with the matching constants inside core's cache-tool-call
 * module. We duplicate the strings here rather than reaching across
 * package internals so the contract stays explicit at both sides.
 */
const SLOT_TOOL_CACHE_STORE_RESOLVER = "resolveToolCacheStore";
const SLOT_CACHE_SOURCE_TASK_RESOLVER = "resolveCacheSourceTask";
const SLOT_OBSERVATION_WRITER = "writeToolObservation";

/**
 * Get-or-create the per-request resolver bag on the request handle.
 * The handle reference is shared across every nested execution scope
 * (the runtime passes `request: requestHandle` into every
 * `createContext` call), so mutations on this bag propagate to worker
 * sequencers, generator tool wraps, and any other nested ctx without
 * going through the JSON-cloned `.state`.
 *
 * Stored as a hidden non-enumerable property so the bag never shows up
 * in state snapshots, devtool inspectors, or serialization passes.
 */
const RESOLVER_BAG_KEY = "__fsd_fix610_resolverBag";

function getRequestResolverBag(ctx: BlockContext): Record<string, unknown> {
  const req = ctx.request as unknown as Record<string, unknown>;
  let bag = req[RESOLVER_BAG_KEY] as Record<string, unknown> | undefined;
  if (bag === undefined) {
    bag = {};
    Object.defineProperty(req, RESOLVER_BAG_KEY, {
      value: bag,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return bag;
}

/**
 * Shared mutable bag stamped onto a board run's outer sequencer state.
 * Both setup and teardown read it; the worker-step resolver reads it to
 * pick up the current ledger / policy.
 *
 * Per-worker state (the current task id) is tracked via AsyncLocalStorage
 * on `workerTaskIdStore`, NOT on this bag — a single shared field would
 * race under `concurrency > 1`, with Worker B's `stampCurrentTaskId`
 * clobbering Worker A's id mid-await and misattributing A's cache writes
 * and observation entries to B.
 */
export interface BoardRunFlowState {
  cacheStore?: ToolCacheStore;
  ledger?: ObservationLedger;
  policy?: TaskFlowPolicy;
  collectionId: string;
}

/**
 * Per-worker task id, scoped via Node's `AsyncLocalStorage`. Each
 * forEach iteration runs in its own async context tree (Node propagates
 * the store through `await` boundaries automatically). The worker
 * body's leading tap calls `enterWith(task.id)` so every subsequent
 * step in that worker — including any cacheable tool call inside a
 * generator — reads its own task id, not a sibling's.
 */
const workerTaskIdStore = new AsyncLocalStorage<string>();

/** Resolve a user-supplied `flowPolicy` value to a concrete `TaskFlowPolicy`. */
export function resolveFlowPolicyValue(
  value: unknown,
  fallback: TaskFlowPolicy,
): TaskFlowPolicy {
  if (value === undefined) return fallback;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFlowPolicy).select === "function"
  ) {
    return value as TaskFlowPolicy;
  }
  // Unknown shape — fall back rather than throwing so an out-of-band
  // misconfiguration doesn't kill the board run. Wrong policies tend
  // to manifest as "no priorWork ever shows up" rather than crashes.
  return fallback;
}

export function defaultBoardFlowPolicy(): TaskFlowPolicy {
  return builtinFlowPolicy.declaredDepsOnly();
}

/**
 * Decide whether to enable the cache. Auto-enabled when any worker
 * tool declares `cacheable`; explicit `toolCache: false` always wins.
 */
export function shouldEnableCache(config: TaskBoardToolCacheConfig | boolean | undefined): boolean {
  if (config === false) return false;
  if (config === true) return true;
  if (config === undefined) return true; // auto — actual install gated on per-tool opt-in
  return config.enabled !== false;
}

export interface InstallBoardFlowStateOptions {
  name: string;
  collectionId: string;
  flowPolicy?: unknown;
  toolCache?: TaskBoardToolCacheConfig | boolean;
  /** Resolves the active collection — same factory the worker step uses. */
  collection: (ctx: BlockContext) => Promise<TaskCollectionRef>;
  /** Shared mutable bag — written by the setup handler, read everywhere else. */
  runState: BoardRunFlowState;
}

/**
 * Build the setup handler that runs at the top of the board's outer
 * sequencer (before seed). Constructs and binds the cache + ledger
 * for the run.
 */
export function createInstallBoardFlowState(
  options: InstallBoardFlowStateOptions,
) {
  const { name, collectionId, runState } = options;
  const cacheEnabled = shouldEnableCache(options.toolCache);
  const cacheCfg =
    typeof options.toolCache === "object" && options.toolCache !== null
      ? options.toolCache
      : {};
  const policy = resolveFlowPolicyValue(options.flowPolicy, defaultBoardFlowPolicy());

  return handler({
    name: `${name}-install-flow-state`,
    transient: true,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      // Resolvers live on a hidden bag attached to `ctx.request` so
      // nested execution scopes (forEach iterations, worker sequencers,
      // generator tool loops) all see the same binding — the request
      // handle is shared by reference across every nested context. We
      // avoid `ctx.request.state` because that gets structured-cloned
      // for state snapshots, and functions can't be cloned.
      const state = getRequestResolverBag(ctx);

      if (cacheEnabled) {
        const store = createInMemoryToolCacheStore({
          defaultTtl: cacheCfg.defaultTtl,
          maxEntries: cacheCfg.maxEntries,
          defaultScope: cacheCfg.defaultScope ?? "run",
        });
        runState.cacheStore = store;
        state[SLOT_TOOL_CACHE_STORE_RESOLVER] = () => runState.cacheStore;
      } else {
        // Explicit clear — a previous board run in the same request
        // would otherwise leave a stale resolver pointing at the old
        // store reference (we drop it on teardown, but defense in depth).
        state[SLOT_TOOL_CACHE_STORE_RESOLVER] = undefined;
      }

      const ledger = createObservationLedger();
      runState.ledger = ledger;
      runState.policy = policy;
      runState.collectionId = collectionId;

      state[SLOT_OBSERVATION_WRITER] = (e: {
        toolName: string;
        args: unknown;
        result?: unknown;
        error?: string;
        cached: boolean;
      }) => {
        // Read taskId from the AsyncLocalStorage scope of the calling
        // worker — never from a shared bag field, which would race under
        // concurrency > 1.
        const taskId = workerTaskIdStore.getStore();
        runState.ledger?.append({
          collectionId,
          ...(taskId !== undefined ? { taskId } : {}),
          toolName: e.toolName,
          args: e.args,
          ...(e.result !== undefined ? { result: e.result } : {}),
          ...(e.error !== undefined ? { error: e.error } : {}),
          cached: e.cached,
          ts: Date.now(),
        });
      };

      // Source-task resolver: cache writes during a worker turn carry
      // the in-progress task id so later cross-task hits can attribute
      // back via `sourceTask`. Same per-worker isolation via ALS.
      state[SLOT_CACHE_SOURCE_TASK_RESOLVER] = () => {
        const taskId = workerTaskIdStore.getStore();
        return taskId !== undefined ? { collectionId, taskId } : undefined;
      };
    },
  });
}

/**
 * Build the teardown handler that runs both on completion (via
 * `.tap(boardMetaCompleted).step(teardown)`) and on error (the outer
 * sequencer adds it under `.rescue`). Clears both stores so a board
 * that loops within the same request starts each run fresh.
 */
export function createTeardownBoardFlowState(options: { name: string; runState: BoardRunFlowState }) {
  const { name, runState } = options;
  return handler({
    name: `${name}-teardown-flow-state`,
    transient: true,
    inputSchema: z.unknown(),
    execute: async (input) => {
      runState.ledger?.clear();
      // Cache store cleanup is a no-op for the in-memory LRU when the
      // store goes out of scope, but we explicitly drop the reference
      // so the LRU is collectible immediately even if something holds
      // a reference to the runState bag.
      runState.cacheStore = undefined;
      runState.ledger = undefined;
      // Dual-purpose handler: also used as a `.rescue` branch on the
      // board's outer sequencer. The rescue path passes the caught
      // error as the handler's input — rethrow so the board failure
      // still surfaces. The success-path `.tap()` passes a non-Error
      // input which we ignore.
      if (input instanceof Error) {
        throw input;
      }
    },
  });
}

/**
 * Build the resolver passed to `buildWorkerStep`. Pulls the active
 * ledger view + policy from the run state and stamps the current task
 * id on the run state so the cache wrapping sees the right
 * attribution. Returns `undefined` when no policy / ledger is bound,
 * which signals `packWorkerInput` to omit `priorWork` entirely
 * (back-compat).
 */
export function createFlowPolicyResolver(runState: BoardRunFlowState) {
  return (
    _ctx: BlockContext,
  ): {
    flowPolicy: TaskFlowPolicy;
    ledger: ObservationLedgerView;
  } | undefined => {
    const policy = runState.policy;
    const ledger = runState.ledger;
    if (policy === undefined || ledger === undefined) return undefined;
    return { flowPolicy: policy, ledger: ledger.view() };
  };
}

/**
 * Helper for the worker body's leading `.tap()` — enters the
 * AsyncLocalStorage scope with this worker's task id so every
 * subsequent step in the same async chain (cache writes, observation
 * appends) reads the right id. `enterWith` mutates the *current*
 * async resource so all downstream `await` chains in this worker
 * iteration inherit the value; sibling worker iterations have their
 * own resource and never see it.
 *
 * `_runState` is accepted only to keep the existing call-site
 * signature stable; it's intentionally unused now that per-worker
 * state lives in ALS.
 */
export function stampCurrentTaskId(_runState: BoardRunFlowState, task: Task): void {
  workerTaskIdStore.enterWith(task.id);
}
