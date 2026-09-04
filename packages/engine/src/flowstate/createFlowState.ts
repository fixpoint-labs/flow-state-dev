/**
 * `createFlowState` — the single user-facing factory that assembles a
 * flow-state runtime from declarative config. It composes the flow registry,
 * model + voice resolvers, store-profile resolution, and instance settings,
 * then wraps `createFlowApiRouter`. Deployment glue (pool tuning, lazy init,
 * platform hooks) lives behind store adapters and platform handler packages,
 * not in user code.
 *
 * Construction is synchronous; store init is lazy and memoized on first
 * `ready()` / `getRouter()` (Prisma's sync-construct / async-connect model),
 * so the same instance works in Next.js Route Handlers without top-level await.
 */
import {
  createModelResolver,
  type CreateModelResolverOptions,
  type FlowStateSettings
} from "@flow-state-dev/core";
import { createFlowRegistry, type FlowRegistry } from "../registry/flow-registry";
import { createFlowApiRouter, type FlowApiRouter } from "../routes/createFlowApiRouter";
import { createRuntimeConfig, resolveStaleSweep, type RuntimeConfig } from "../runtime-config";
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  type RuntimeLogger,
  type RuntimeLoggerLevel
} from "../execution/logging";
import { abortRequest } from "../execution/abort-registry";
import { detectInterruptedRequests } from "../execution/request-recovery";
import { createCheckpointDurabilityProvider } from "../durability/checkpoint-durability-provider";
import { FlowStateConfigError, FlowStateDisposedError } from "../errors/flow-error";
import type { CapabilitySlot, StoreAdapter, StoresConfig } from "../stores/store-adapter";
import { resolveProfileStores } from "./resolve-slots";
import type { FlowDispatcher } from "../transports/dispatcher";
import {
  createDispatchOperation,
  type DispatchOperation,
  type DispatchedChild
} from "../context/dispatch-operation";
import type { InboundTransportHost } from "../transports/types";
import type { StoreRegistry } from "../stores/types";
import { createInboundTransportHost } from "../transports/host/createInboundTransportHost";
import { isInProcessDispatcher } from "../transports/host/in-process-dispatcher";
import { createConcurrencyArbiter } from "../transports/concurrency/arbiter";
import { defaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import type {
  CreateFlowStateOptions,
  FlowState,
  FlowStateModelsConfig,
  FlowStateRuntime,
  WorkerHandle,
  WorkerMode
} from "./types";

/**
 * How many times `dispose()` re-checks for detached work before giving up.
 *
 * Each round exists only because the previous one's children started more, so
 * reaching the bound means a flow is spawning without end rather than that the
 * work is slow. High enough that legitimate nesting never hits it.
 */
const MAX_DETACHED_DRAIN_ROUNDS = 32;

/** How many outstanding children the truncation warning names before eliding. */
const MAX_NAMED_TRUNCATED_CHILDREN = 5;

/**
 * Most time a cancelled child gets to unwind before the stores close.
 *
 * An aborted run throws at its next await and writes a terminal record, and that
 * write needs the adapters still open — cancelling and closing in the same tick
 * would trade a run that never finished for one that half-wrote.
 *
 * A **cap on a slice of the drain budget**, not an addition to it: the reserve
 * is carved out of `dispatchDrainTimeoutMs` so the option stays a true ceiling.
 */
const DETACHED_ABORT_UNWIND_MS = 2_000;

/**
 * Fraction of the drain budget reserved for unwinding cancelled children.
 *
 * A quarter: waiting for work to finish is the point and unwinding is its tail,
 * so the reserve must never dominate. It matters most on a small budget, where a
 * flat 2s reserve would leave no time to wait at all — at 1.5s it reserves
 * 375ms and still spends 1.125s waiting.
 */
const DETACHED_UNWIND_BUDGET_SHARE = 4;

/**
 * Default ceiling on how long `dispose()` waits for in-process detached work.
 *
 * 30s, chosen against the two callers rather than picked for roundness:
 *
 * - **Production shutdown.** `dispose()` runs under a termination signal inside
 *   a platform grace period — 30s is Kubernetes' default
 *   `terminationGracePeriodSeconds`, after which the process is killed anyway.
 *   A longer default could not be honoured, so it would be a promise the
 *   platform breaks rather than one we keep.
 * - **`fsdev run` verifying a flow.** Measured against the harness this was
 *   built with, an in-process detached child settles in ~85ms with no model call
 *   and ~880ms behind a 750ms sleep; 30s leaves room for a real agent turn with
 *   several model calls, which is the case a verification run actually cares
 *   about.
 *
 * It is a **ceiling on the wait, not a target** — work that finishes sooner is
 * never delayed, and this only decides when to stop waiting and say so.
 *
 * Deliberately the same order as the sibling budgets in this runtime
 * (`QUEUE_WAIT_TIMEOUT_MS`, the 30s stale-request default), so a deployment
 * tuning one is not surprised by another on a different scale.
 */
const DEFAULT_DETACHED_DRAIN_TIMEOUT_MS = 30_000;

/**
 * How long `dispose()` gives the startup recovery sweep to finish before it
 * closes the stores out from under it.
 *
 * Bounded rather than awaited outright, for the same reason the detached drain
 * is: a store that has stopped answering must not be able to wedge shutdown.
 * Fixed rather than configurable — the sweep is one indexed query plus a write
 * per stale row, so a host with an opinion about this number has a much larger
 * problem than this bound.
 */
const RECOVERY_SWEEP_DRAIN_MS = 5_000;

/**
 * Resolve the drain budget, rejecting values that cannot bound anything.
 *
 * `NaN` is what `Number(process.env.X)` yields from a typo, and every comparison
 * against it is false — the deadline would never be considered reached, which is
 * precisely the hang this bound exists to remove. A negative or zero budget is
 * honoured as "do not wait": that is a legitimate choice for a host that wants
 * shutdown to be immediate, and it still reports what it left behind.
 */
function resolveDispatchDrainTimeout(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured)) {
    return DEFAULT_DETACHED_DRAIN_TIMEOUT_MS;
  }
  return Math.max(0, configured);
}

/**
 * Resolve `true` when `pending` settles within `ms`, `false` when the budget runs
 * out first. Never rejects — the caller passes an `allSettled`, and a timeout is
 * an answer rather than an error.
 *
 * The timer is deliberately **referenced**, and that is load-bearing rather than
 * incidental. An earlier version `unref`'d it to avoid "holding the process
 * open", which inverted the whole mechanism: a child that never settles usually
 * owns no referenced handle either, an awaited promise keeps nothing alive on
 * its own, so Node drained the loop and exited *immediately* — before the
 * timeout fired, before the truncation was reported, and before the worker and
 * store adapters were closed. The budget existed and was never reached.
 *
 * Keeping it referenced is safe because every exit from this function goes
 * through `finish`, which clears the timer, so a drain that completes early
 * leaves nothing armed to hold the process past its work.
 */
function settledWithin(pending: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), ms);
    void pending.then(
      () => finish(true),
      () => finish(true)
    );
  });
}

function toModelResolverOptions(
  models: FlowStateModelsConfig | undefined
): CreateModelResolverOptions {
  return {
    defaultModel: models?.default,
    intents: models?.intents,
    gateways: models?.gateways,
    retryPolicy: models?.retryPolicy,
    providers: models?.providers,
    providerPreference: models?.providerPreference,
    keys: models?.keys
  };
}

/** Distinct adapters across all declared profiles, for `dispose()`. */
function collectAdapters(stores: StoresConfig): StoreAdapter[] {
  const seen = new Set<StoreAdapter>();
  for (const profile of Object.values(stores)) {
    for (const adapter of Object.values(profile)) {
      if (adapter !== undefined) seen.add(adapter);
    }
  }
  return [...seen];
}

function declaredSlots(stores: StoresConfig): Record<string, CapabilitySlot[]> {
  const out: Record<string, CapabilitySlot[]> = {};
  for (const [name, profile] of Object.entries(stores)) {
    out[name] = Object.keys(profile) as CapabilitySlot[];
  }
  return out;
}

class InternalFlowState<TSettings extends object>
  implements FlowState<TSettings>
{
  readonly #options: CreateFlowStateOptions<TSettings>;
  readonly #registry: FlowRegistry;
  readonly #profileKeys: string[];
  readonly #allAdapters: StoreAdapter[];
  #resolvedProfile: string | undefined;
  #runtimePromise: Promise<FlowStateRuntime> | null = null;
  #initPromise: Promise<FlowApiRouter> | null = null;
  #disposed = false;
  /**
   * Whether a router — and therefore a stale-request sweeper — has been asked
   * for (FIX-999). Set by `#init()` BEFORE it awaits the runtime, so
   * `#buildRuntime` can stamp the sweep cadence onto the shared config it is
   * about to hand `worker.startWorker`. A colocated worker starts consuming the
   * moment it is started, and the host a job builds is built once, so a job
   * claimed before that stamp lands would carry `sweeper-not-running` for its
   * whole life — after `ready()` started the very sweeper it was refusing on
   * behalf of.
   */
  #routerRequested = false;
  /** Dispatcher built by the worker adapter during runtime init. */
  #workerDispatcher: FlowDispatcher | undefined;
  /** Started worker, closed by dispose() before store adapters. */
  #workerHandle: WorkerHandle | undefined;
  /**
   * In-process dispatched children still running, drained by `dispose()`.
   *
   * Only ever populated by the operation `#installDispatchOperation` installs
   * — a queue-backed child runs in another process and is not this one's to wait
   * for. Entries remove themselves when they settle, so a long-lived server does
   * not accumulate them.
   */
  readonly #dispatchedChildren = new Set<DispatchedChild>();
  /**
   * The host the request-host operations dispatch through, built on first use
   * and shared by the detached start and the dispatch seam — see
   * `#hostForRequestHostOperations`.
   */
  #requestHostOperationsHost: InboundTransportHost | undefined;
  /**
   * The resolved runtime config, kept so `dispose()` can read the logger a host
   * configured. Held as the object rather than the logger value: a host may
   * install one after `getRuntime()` returns.
   */
  #resolvedRuntimeConfig: RuntimeConfig | undefined;
  /**
   * The in-flight startup recovery sweep, held so `dispose()` can let it finish
   * before the adapters it is writing through are closed. Never rejects — the
   * sweep owns its own failure reporting.
   */
  #recoverySweep: Promise<void> | undefined;
  /**
   * The one concurrency arbiter every host in this process shares (FIX-1077).
   *
   * Two hosts exist in a router deployment — the one the dispatch operation
   * is built over, and the router's. Each would otherwise own a private keyed
   * gate, so a child session dispatched by an HTTP request could start
   * under a `user`/`session` key its own parent still held: a declared `queue`
   * policy silently not serialising, or a `reject` policy silently admitting.
   * Policy is a property of the flow, not of whichever host took the dispatch.
   */
  readonly #arbiter = createConcurrencyArbiter();

  constructor(options: CreateFlowStateOptions<TSettings>) {
    if (Object.hasOwn(options, "middleware")) {
      throw new FlowStateConfigError(
        "createFlowState: the removed `middleware` option is not executed. " +
          "Move policy checks to the HTTP authentication layer or block logic."
      );
    }

    if (Object.hasOwn(options, "detachedDrainTimeoutMs")) {
      throw new FlowStateConfigError(
        "createFlowState: `detachedDrainTimeoutMs` is now `dispatchDrainTimeoutMs`. " +
          "Accepting it silently would leave the shutdown drain on its default, so a host " +
          "tuned for a long-running child would truncate one without saying why."
      );
    }

    this.#options = options;
    this.#profileKeys = Object.keys(options.stores);

    if (this.#profileKeys.length === 0) {
      throw new FlowStateConfigError(
        "createFlowState: stores must declare at least one profile"
      );
    }

    if (options.worker !== undefined && options.dispatcher !== undefined) {
      throw new FlowStateConfigError(
        "createFlowState: `worker` and `dispatcher` are mutually exclusive. " +
          "The worker adapter provides its own dispatcher; pass one or the other."
      );
    }

    if (
      options.defaultProfile !== undefined &&
      !(options.defaultProfile in options.stores)
    ) {
      throw new FlowStateConfigError(
        `createFlowState: defaultProfile "${options.defaultProfile}" but no such profile is declared. ` +
          `Declared profiles: ${this.#profileKeys.join(", ")}`
      );
    }

    // Build the registry synchronously so a duplicate flow kind/id surfaces
    // at construction rather than on the first request.
    this.#registry = createFlowRegistry();
    for (const flow of Object.values(options.flows)) {
      this.#registry.register(flow);
    }

    this.#allAdapters = collectAdapters(options.stores);
  }

  get activeProfile(): string {
    return this.#resolveProfileName();
  }

  get settings(): TSettings {
    return this.#options.settings ?? ({} as TSettings);
  }

  get meta(): FlowState<TSettings>["meta"] {
    return {
      flowKeys: Object.keys(this.#options.flows),
      profileKeys: this.#profileKeys,
      declaredSlots: declaredSlots(this.#options.stores),
      devtool: this.#options.devtool
    };
  }

  ready(): Promise<void> {
    return this.#init().then(() => undefined);
  }

  getRouter(): Promise<FlowApiRouter> {
    return this.#init();
  }

  getRuntime(): Promise<FlowStateRuntime> {
    return this.#runtime();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    // Let an in-flight init settle so adapters that opened pools mid-init
    // still get a clean dispose. Either surface (getRuntime / getRouter) can
    // be the one that opened the pools. A failed init is swallowed here —
    // disposal must proceed regardless.
    for (const pending of [this.#runtimePromise, this.#initPromise]) {
      if (pending === null) continue;
      try {
        await pending;
      } catch {
        // init failed; adapters may still hold partially-opened resources.
      }
    }

    // Detached children first, for the same reason the worker is stopped before
    // the stores: they are still writing. See `#drainDetachedChildren`.
    //
    // Guarded, and the guard is not defensive padding: the drain calls a
    // HOST-SUPPLIED `RuntimeLogger`, and a logger that throws would otherwise
    // reject `dispose()` here — before the worker closes and before a single
    // store adapter is released. Diagnostics must never be able to strand the
    // backend they are describing. Reported through `console.error` for the
    // same reason the give-up report is: the logger is the thing that just
    // failed.
    try {
      await this.#drainDetachedChildren();
    } catch (err) {
      console.error("[flowstate] detached drain failed", err);
    }

    // The startup recovery sweep writes through these same adapters, and on a
    // short-lived process it is entirely normal for shutdown to arrive while it
    // is still running. Bounded, so a store that has stopped answering cannot
    // wedge shutdown — the sweep is best-effort by design, and a later start
    // sweeps whatever this one did not reach.
    if (this.#recoverySweep !== undefined) {
      await settledWithin(this.#recoverySweep, RECOVERY_SWEEP_DRAIN_MS);
    }

    // Stop the execution backend before the stores close: the worker drains
    // in-flight jobs (which write to the stores), then the adapter releases
    // its queue/connections.
    try {
      await this.#workerHandle?.close();
    } catch (err) {
      console.error("[flowstate] worker close failed", err);
    }
    try {
      await this.#options.worker?.close?.();
    } catch (err) {
      console.error("[flowstate] worker adapter close failed", err);
    }

    for (const adapter of this.#allAdapters) {
      try {
        await adapter.dispose?.();
      } catch (err) {
        console.error("[flowstate] adapter dispose failed", err);
      }
    }
  }

  /**
   * Wait for in-process detached work before anything it writes to is closed.
   *
   * Detachment means the launching *request* does not wait. It cannot mean the
   * *process* does not wait, because in a one-shot process — `fsdev run`, a
   * script, a test — outliving the request would mean outliving the process, and
   * that is not on offer. The only two options there are draining and silently
   * truncating, and truncating is how a `fsdev run` of a detached board left its
   * task row stranded `in_progress` with the child failing on a closed store
   * (FIX-1077). For the tool `AGENTS.md` names as the default way to verify a
   * flow change, that is the worse answer.
   *
   * A long-lived server is unaffected in practice: it disposes at shutdown, when
   * waiting for background work to finish is what you want anyway.
   *
   * Rounds, not one pass: detached work may itself detach, and a grandchild
   * registered while we await belongs to this drain too.
   *
   * ## Bounded, because "unbounded" is not patience
   *
   * Every wait here races a deadline. A round cap alone bounded the number of
   * batches and not the wait inside one, so a single child that never settles —
   * a child blocked on an external call — meant the `await` never returned,
   * the cap was never reached, and `dispose()` hung forever, taking `fsdev run`
   * and any production shutdown with it.
   *
   * The principle was never "wait forever", it was **don't truncate silently**,
   * and a bounded wait that names what it abandoned satisfies that completely. A
   * hang does not, and is strictly worse than the truncation it was avoiding: a
   * stranded row at least leaves a record someone can find, where a wedged
   * process leaves nothing.
   */
  async #drainDetachedChildren(): Promise<void> {
    if (this.#dispatchedChildren.size === 0) return;

    const budgetMs = resolveDispatchDrainTimeout(this.#options.dispatchDrainTimeoutMs);
    const startedAt = Date.now();
    // ONE deadline for the whole drain, not one per round. A per-round budget
    // multiplies by the round cap, so a slow-but-progressing spawn chain could
    // still hold shutdown for many minutes.
    const deadline = startedAt + budgetMs;
    // Cancellation needs time INSIDE the budget, not after it. An aborted run
    // throws at its next await and writes a terminal record, and that write
    // needs the adapters still open — so the unwind is carved out of the
    // deadline rather than added to it. Added, the option stopped being a
    // ceiling: `0` (documented as immediate shutdown) still waited the full
    // unwind, and the 30s default ran to ~32s before any cleanup began.
    //
    // A fraction, capped: the wait is the point and the unwind is its tail, so
    // reserving a quarter keeps the reserve from ever dominating a small budget
    // while the cap keeps a large one from reserving absurdly long. At `0` both
    // terms are `0`, so nothing waits and nothing unwinds — which is what the
    // option says it does.
    const unwindMs = Math.min(
      DETACHED_ABORT_UNWIND_MS,
      Math.floor(budgetMs / DETACHED_UNWIND_BUDGET_SHARE)
    );
    const waitDeadline = deadline - unwindMs;

    for (
      let round = 0;
      this.#dispatchedChildren.size > 0 && round < MAX_DETACHED_DRAIN_ROUNDS;
      round += 1
    ) {
      const remainingMs = waitDeadline - Date.now();
      if (remainingMs <= 0) break;

      const pending = [...this.#dispatchedChildren];
      // Printed because an unexplained pause at exit reads as a hang — this says
      // what is being waited for.
      //
      // Through the configured logger, not `console` directly: `fsdev run
      // --quiet` promises to suppress runtime logs on stderr, and a host that
      // installed a silent logger meant it. This line is NARRATION — progress
      // toward a normal outcome — and narration is exactly what the flag exists
      // to switch off. (The give-up warning below is a different kind of thing
      // and is treated differently; see there.)
      //
      // `warn`, not `info`, and that is about the SINK rather than the severity:
      // `DEFAULT_RUNTIME_LOGGER.info` writes to `console.info` — stdout — which
      // would corrupt the NDJSON stream `fsdev run` puts there. `warn` lands on
      // stderr, where every other diagnostic in this file already goes.
      this.#logShutdown(
        "warn",
        `[flowstate] waiting for ${pending.length} dispatched request(s) to finish before shutdown`,
        { pending: pending.length, budgetMs }
      );

      // Settled, not all: a child that threw has already surfaced its own error,
      // and one failure must not abandon the rest of the drain.
      const finishedInTime = await settledWithin(
        Promise.allSettled(pending.map((child) => child.finished)),
        remainingMs
      );
      if (!finishedInTime) break;
    }

    if (this.#dispatchedChildren.size > 0) {
      await this.#cancelOutstandingChildren(deadline, startedAt, budgetMs);
    }
  }

  /**
   * Cancel detached work the budget ran out on, then let it unwind.
   *
   * Reporting alone was not enough, and the gap was the dangerous kind. The
   * budget expired, the warning printed, and `dispose()` went on to close the
   * worker and every store adapter — while the child kept running. Two things
   * followed: the process could stay alive well past the timeout it advertised
   * (the run's own heartbeat timer is a referenced handle), and the child went
   * on writing **through disposed adapters**, which is worse than either a hang
   * or a stranded row because the write goes somewhere undefined.
   *
   * `abortRequest` is the framework's own teardown seam — the single point both
   * the abort route and `runAction`'s cross-process heartbeat poll converge on —
   * so a shutdown cancel is indistinguishable downstream from a user's. Every
   * child here is in-process by construction (the locality gate), so its
   * controller is in this process's registry.
   *
   * The brief unwind wait afterwards is what makes the cancel worth doing: an
   * aborted run throws at its next await and writes a terminal record, and that
   * write needs the stores still open. It runs against the SAME deadline the
   * wait phase did, so the whole drain — waiting, cancelling and unwinding —
   * fits inside `dispatchDrainTimeoutMs` rather than overrunning it by a
   * constant. A child that ignores its abort signal therefore cannot re-open the
   * hang this method exists to close, and a `0` budget cancels and returns
   * without waiting at all.
   */
  async #cancelOutstandingChildren(
    deadline: number,
    startedAt: number,
    budgetMs: number
  ): Promise<void> {
    const abandoned = [...this.#dispatchedChildren];

    for (const child of abandoned) {
      // Best-effort by contract: `false` means the run already deregistered,
      // which is a race we win by doing nothing.
      //
      // Guarded per child, and not defensively: `abortRequest` fires the run's
      // own abort listeners SYNCHRONOUSLY, and `runAction`'s listener logs
      // through the host-supplied logger. A logger that throws therefore throws
      // out of `abortRequest` — and out of this loop, leaving every child after
      // the first one running. Cancelling the rest matters more than reporting
      // that one of them complained.
      try {
        abortRequest(child.requestId);
      } catch (err) {
        console.error("[flowstate] cancelling a detached request failed", err);
      }
    }

    // NOT terminalized here, deliberately — this drain does not write terminal
    // status on a child's behalf.
    //
    // An earlier version did, to stop an abandoned row reading `in_progress`
    // forever. Three separate defects followed, and all of them were the same
    // mistake wearing different clothes: the write raced the child's own
    // (overwriting a real `completed` with `aborted`), it mislabelled the
    // event (`runAction` writes the resumable `interrupted` for a signal with
    // no persisted intent, and the drain's `aborted` fought it), and doing
    // store I/O inside a bounded shutdown made the bound unenforceable.
    //
    // The substrate already answers this, and answers it better. A detached
    // child outliving its parent process is the NORMAL case for durable work,
    // not an anomaly to tidy up:
    //
    // - **The task row** recovers by lease. `isClaimable` admits a row whose
    //   lease has lapsed even though its status is `in_progress`, and
    //   `claimDisposition` either re-claims it or settles it `errored` once
    //   `maxAbandonments` is exhausted — inside the atomic claim write. A
    //   lapsed row does not block quiescence either: `runsElsewhere` counts it
    //   as in-flight only while the lease is live.
    // - **The request record** recovers on the next start.
    //   `detectInterruptedRequests` marks an abandoned `in_progress` record
    //   `interrupted`, which is the resumable status and exactly what a run
    //   stopped by its process going away should read as.
    //
    // This is the same conclusion the epic reached when it removed the
    // `started` milestone: lease lapse plus reclaim is the designed recovery
    // path, and a parent asserting things about a child's row was the error.
    // Aborting is ours to do; settling is not.

    // Whatever is left of the budget, which is the slice reserved for exactly
    // this. Never negative — `settledWithin` treats `0` as "one tick, then give
    // up", so an exhausted budget still yields to let a just-aborted run reach
    // its rejection rather than skipping the unwind entirely.
    const unwindMs = Math.max(0, deadline - Date.now());
    await settledWithin(
      Promise.allSettled(abandoned.map((child) => child.finished)),
      unwindMs
    );

    this.#reportTruncatedChildren(abandoned, Date.now() - startedAt, budgetMs);
  }

  /**
   * Report detached work shutdown did not wait out — loudly, and by name.
   *
   * **Deliberately not routed through the configured logger**, which is the one
   * place in this file that bypasses it. The waiting notice is narration and
   * `--quiet` silences it; this is an *outcome*: work was started and may not
   * have finished. Nothing else reports it — the launching request already
   * returned successfully, so the process exit code is a success — which means
   * suppressing this is silent truncation, the exact failure the drain exists to
   * prevent. Quiet means "don't narrate", not "don't tell me something went
   * wrong".
   *
   * `console.error` rather than `console.warn` for the same sink reasoning as
   * the notice: both are stderr, and error is the honest level for "this may not
   * have completed". A structured-logging deployment loses structure on this one
   * exceptional line and never loses the line itself.
   *
   * The ids are the point. "Gave up on 3 requests" is barely better than
   * silence; the request and session ids are what someone reads the rows back
   * with afterwards.
   */
  #reportTruncatedChildren(
    abandoned: readonly DispatchedChild[],
    elapsedMs: number,
    budgetMs: number
  ): void {
    const named = abandoned
      .slice(0, MAX_NAMED_TRUNCATED_CHILDREN)
      .map((child) => `${child.requestId} (session ${child.sessionId})`)
      .join(", ");
    const overflow = abandoned.length - MAX_NAMED_TRUNCATED_CHILDREN;

    console.error(
      `[flowstate] shutdown cancelled ${abandoned.length} dispatched request(s) ` +
        `after ${elapsedMs}ms (budget ${budgetMs}ms); they may not have completed: ` +
        `${named}${overflow > 0 ? `, and ${overflow} more` : ""}`
    );
  }

  /** Emit a shutdown diagnostic through the runtime's configured logger. */
  #logShutdown(
    level: "warn",
    message: string,
    context: Record<string, unknown>
  ): void {
    this.#logVia(level, message, context);
  }

  /**
   * A `RuntimeLogger` that forwards to whichever logger is configured AT CALL
   * TIME, falling back to the framework default.
   *
   * Exists because the host may install its logger after the runtime resolves —
   * the CLI does, which is how `--quiet` reaches output produced by work that
   * started during initialization.
   */
  readonly #deferredLogger: RuntimeLogger = {
    debug: (m, c) => this.#logVia("debug", m, c),
    info: (m, c) => this.#logVia("info", m, c),
    warn: (m, c) => this.#logVia("warn", m, c),
    error: (m, c) => this.#logVia("error", m, c)
  };

  /**
   * Route one line through the configured logger, resolved at call time.
   *
   * Read from the runtime config rather than captured, because a host may
   * install its logger after resolving the runtime — the CLI does exactly that,
   * which is how `--quiet` reaches a line written during `dispose()`. Falls back
   * to the framework default so a deployment that configures nothing still sees
   * it.
   *
   * A host-supplied logger is arbitrary code, and every caller of this is either
   * shutdown or a fire-and-forget recovery sweep — paths where a throw costs far
   * more than the line was worth. Unguarded, the drain would lose its cancel and
   * its unwind, and `dispose()` would reject before a single store adapter was
   * released. The guard in `dispose()` catches whatever else the drain can
   * throw; this one keeps a failed diagnostic from being that thing.
   */
  #logVia(
    level: RuntimeLoggerLevel,
    message: string,
    context: Record<string, unknown>
  ): void {
    try {
      logRuntimeEvent(
        this.#resolvedRuntimeConfig?.logger ?? DEFAULT_RUNTIME_LOGGER,
        level,
        message,
        context
      );
    } catch (err) {
      console.error("[flowstate] runtime logger failed", err);
    }
  }

  /**
   * Sweep requests a previous process abandoned, on EVERY initialization.
   *
   * This used to be reachable only through `createFlowRouteHandlers`, so it ran
   * for a deployment that built a router and for nobody else. Every producer of
   * the `interrupted` status sat behind that same door — startup detection, the
   * periodic sweeper, and the recovery route — which left the router-less
   * topologies (`fsdev run`, `fsdev chat`) with no way for an abandoned record
   * to ever be reclassified. A run cut short there stayed `in_progress`
   * forever, and later invocations against the same store swept nothing.
   *
   * That is the exact topology detached work now runs in, and shutdown
   * deliberately does not settle a child's record — it aborts and leaves the
   * substrate to recover. That division only holds if something recovers, so
   * this is the half that was missing rather than an extra safety net.
   *
   * Cost is one `listStale` against the active-request registry, which holds
   * IN-FLIGHT requests only — bounded by concurrency, not by history — plus a
   * read and a write per genuinely stale entry. Fire-and-forget, so it never
   * delays startup, and on a clean store it is a single empty query. It honours
   * the `detectInterruptedOnStartup` option, which already exists and already
   * means precisely this; the runtime path simply never implemented it.
   *
   * A router deployment now sweeps twice at startup, once here and once in
   * `createFlowRouteHandlers`. That is deliberate and costs an empty scan: the
   * detection is idempotent (only a still-`in_progress` record is touched), so
   * the second pass finds the first pass's work already done. The alternative
   * was a flag threaded into the route handlers to suppress theirs, which buys
   * a no-op query at the price of a new option on a public surface — and the
   * handlers must keep their own call regardless, for the same reason they keep
   * their own dispatch-operation installer: a caller mounting the router without
   * a `FlowState` has no other owner.
   *
   * Both bounds come off the SAME `resolveStaleSweep` values the request host
   * was stamped with, so a sweep here cannot reap on a different clock than the
   * liveness gate in this very process reads on.
   */
  #detectInterruptedOnStartup(
    stores: StoreRegistry,
    staleThresholdMs: number | undefined,
    queuedGraceMs: number | undefined
  ): void {
    if (this.#options.detectInterruptedOnStartup === false) return;

    // RETAINED, not fire-and-forget. `dispose()` waits on this before it closes
    // any adapter, because the two race on a short-lived process and the sweep
    // loses: `fsdev run` can resolve its runtime, do its work and start
    // shutting down while the sweep is still mid-query. The store closes, the
    // sweep's write throws, the `catch` below swallows it, and the abandoned
    // row stays `in_progress` — which is the precise outcome this sweep exists
    // to prevent, arrived at through the fix for it.
    //
    // Invisible on the in-memory store, whose reads and writes settle in the
    // same microtask. It is the durable adapters — the ones that make an
    // abandoned row matter at all — where the gap is wide enough to lose.
    this.#recoverySweep = detectInterruptedRequests({
      stores,
      staleThresholdMs,
      queuedGraceMs,
      // Resolved per call rather than captured, for the same reason
      // `#logShutdown` does it: the CLI installs its logger onto the resolved
      // config AFTER `getRuntime()` returns, and this sweep is already running
      // by then. Captured, `--quiet` would be bypassed by the one log line a
      // recovering run emits — which is exactly the flag's job to suppress,
      // since a swept row is narration about the past, not this run's outcome.
      logger: this.#deferredLogger
    })
      .then(() => undefined)
      .catch((err: unknown) => {
        // Never fails initialization: recovery is a courtesy pass over old rows,
        // and a store that cannot answer it can still serve the run being
        // started.
        console.error("[flowstate] interrupted-request detection failed", err);
      });
  }

  #init(): Promise<FlowApiRouter> {
    if (this.#disposed) {
      throw new FlowStateDisposedError(
        "FlowState.getRouter()/ready() called after dispose()"
      );
    }
    if (this.#initPromise === null) {
      // Before `#doInit()` is invoked, because it reaches `#buildRuntime` —
      // and therefore `worker.startWorker` — inside its first await. See
      // `#routerRequested`.
      this.#routerRequested = true;
      this.#initPromise = this.#doInit();
    }
    return this.#initPromise;
  }

  #runtime(): Promise<FlowStateRuntime> {
    if (this.#disposed) {
      throw new FlowStateDisposedError(
        "FlowState.getRuntime() called after dispose()"
      );
    }
    if (this.#runtimePromise === null) {
      this.#runtimePromise = this.#buildRuntime();
    }
    return this.#runtimePromise;
  }

  #resolveProfileName(): string {
    if (this.#resolvedProfile !== undefined) return this.#resolvedProfile;

    const fromEnv = process.env.FSD_ENV;
    if (fromEnv !== undefined && fromEnv.length > 0) {
      if (!(fromEnv in this.#options.stores)) {
        throw new FlowStateConfigError(
          `FSD_ENV="${fromEnv}" but no profile "${fromEnv}" is declared. ` +
            `Declared profiles: ${this.#profileKeys.join(", ")}`
        );
      }
      this.#resolvedProfile = fromEnv;
      return fromEnv;
    }

    if (this.#options.defaultProfile !== undefined) {
      // Existence already validated in the constructor.
      this.#resolvedProfile = this.#options.defaultProfile;
      return this.#resolvedProfile;
    }

    this.#resolvedProfile = this.#profileKeys[0]!;
    return this.#resolvedProfile;
  }

  /**
   * Resolve the runtime internals once: open the active profile's stores and
   * assemble the forwarded runtime-config bundle. Both `getRouter()` and
   * `getRuntime()` share this memoized result, so they never double-init the
   * stores or diverge on which `StoreRegistry` they use.
   */
  async #buildRuntime(): Promise<FlowStateRuntime> {
    const profileName = this.#resolveProfileName();
    const profile = this.#options.stores[profileName]!;
    const { stores } = await resolveProfileStores({ profileName, profile });

    // Diagnostic on stderr (like the worker/dispose logs below): stdout is
    // reserved for data streams such as `fsdev run`'s NDJSON, which a config
    // load must not corrupt.
    // eslint-disable-next-line no-console
    console.error(`[flowstate] active profile: "${profileName}"`);

    const modelResolver =
      this.#options.modelResolver ??
      createModelResolver(toModelResolverOptions(this.#options.models));
    const voiceProvider = this.#options.voice?.provider;

    // Bundle the forwarded instance-level options here, at the public
    // boundary. The intermediate execution-chain layers take this bundle
    // verbatim — adding a new forwarded field means one line here, not a
    // per-layer signature change.
    // Durable execution: build the default checkpoint provider from the SAME
    // resolved stores the router/worker use, so checkpoints, suspensions, and
    // leases all read/write the active profile. Opt-in via `durable: true`.
    const durabilityProvider = this.#options.durable === true
      ? createCheckpointDurabilityProvider(stores)
      : undefined;

    // The request-host seam (FIX-999) belongs on the SHARED config, not on the
    // router's copy of it. This config is handed to `worker.startWorker` below
    // and to `createFlowApiRouter` in `#doInit`, so a colocated or worker-only
    // execution reaches `createExecutionContext` through the same construction
    // inputs an HTTP request does. Stamping it only in the router left every
    // worker-side `runAction` without the seam, so `requireRequestHost(ctx)`
    // threw there for exactly the reason it used to throw everywhere.
    //
    // The sweeper facts come from `resolveStaleSweep` — the same rule the
    // router applies to the pair it builds its own sweeper from — so the gate
    // and the sweeper cannot describe different cadences. The dispatch
    // operation is wired at the bottom of this method, once the dispatcher it must go
    // through is resolved; `parentTask` stays unwired here, and that verb
    // refuses by name rather than pretending otherwise.
    //
    // Destructured rather than spread wholesale onto `requestHost`:
    // `queuedGraceMs` is a sweep bound, not a gate fact, and the liveness read
    // deliberately leaves queued entries unbounded so the sweep owns that
    // clock. It rides the config instead, which is what startup detection and
    // the `check-interrupted` route read.
    //
    // `staleSweepIntervalMs` is stamped here ONLY when a router has been asked
    // for, and its absence otherwise is the honest answer rather than an
    // omission. The sweeper is constructed by `createFlowApiRouter`, which only
    // `getRouter()` / `ready()` reach — a deployment that initializes solely
    // through `getRuntime()` (`fsdev run`, `fsdev chat`) has nothing sweeping at
    // all. Stamping unconditionally advertised a sweeper that does not exist,
    // and the gate's third arm — the one that refuses precisely because an
    // unswept shared registry reports a crashed worker as live forever — was
    // then satisfied by a number rather than by a fact.
    //
    // `#routerRequested` is what separates the two cases, and it has to be read
    // HERE rather than after this method returns: `worker.startWorker` is called
    // a few lines below with this very config, a colocated worker begins
    // consuming immediately, and the request host a job builds is built once. A
    // cadence recorded after this method returns therefore arrives too late for
    // every job claimed on the way up — each one carrying `sweeper-not-running`
    // for its whole life, after `ready()` started the sweeper it was refusing on
    // behalf of.
    //
    // The router restamps this pair from its own resolved options onto its own
    // copy of the config, so the HTTP path is unaffected either way.
    const { queuedGraceMs, staleThresholdMs, staleSweepIntervalMs } =
      resolveStaleSweep(this.#options);

    const runtimeConfig = createRuntimeConfig({
      modelResolver,
      voiceProvider,
      settings: this.#options.settings as FlowStateSettings | undefined,
      onBackgroundWork: this.#options.onBackgroundWork,
      defaultSseHeartbeatMs: this.#options.defaultSseHeartbeatMs,
      durabilityProvider,
      durabilityRetention: this.#options.durabilityRetention,
      errorCapture: this.#options.errorCapture,
      queuedGraceMs,
      publicReentrySources: this.#options.publicReentrySources,
      maxChildSessionListLimit: this.#options.maxChildSessionListLimit,
      requestHost: {
        staleThresholdMs,
        ...(this.#routerRequested ? { staleSweepIntervalMs } : {})
      }
    });

    this.#resolvedRuntimeConfig = runtimeConfig;

    // BEFORE the worker wiring and before any router exists, so every later copy
    // of `requestHost` carries it. See `#installDispatchOperation`.
    this.#installDispatchOperation(runtimeConfig, stores);

    this.#detectInterruptedOnStartup(stores, staleThresholdMs, queuedGraceMs);

    const runtime: FlowStateRuntime = {
      registry: this.#registry,
      stores,
      runtimeConfig,
      ...(this.#options.chat !== undefined ? { chat: this.#options.chat } : {})
    };

    // Execution-backend wiring: the adapter gets the SAME resolved runtime
    // the router uses, so the dispatch side and the worker can never
    // disagree on stores. A failure here rejects runtime init on purpose —
    // a queue-routed deployment whose queue is unreachable should fail
    // loudly, not limp along half-wired.
    const worker = this.#options.worker;
    const workerMode = worker?.mode ?? "colocated";
    if (worker !== undefined) {
      if (workerMode !== "worker-only") {
        this.#workerDispatcher = worker.createDispatcher(runtime);
      }
      if (workerMode !== "dispatch-only") {
        this.#workerHandle = worker.startWorker(runtime);
      }
    }

    return runtime;
  }

  /**
   * Install the dispatch seam's operation on the shared config, before any fork
   * of `requestHost` exists, because `createFlowApiRouter` rebuilds `requestHost` as a
   * fresh literal, so anything stamped there lands on a copy a colocated worker
   * never sees.
   *
   * The disposal gate is the detached start's, applied to the same instant: a
   * dispatched child runs here under the same drain, so admission has to close
   * for it at the same moment or the drain's snapshot is incomplete.
   */
  #installDispatchOperation(runtimeConfig: RuntimeConfig, stores: StoreRegistry): void {
    const requestHost = runtimeConfig.requestHost;
    if (requestHost === undefined) return;
    if (requestHost.dispatchOperation !== undefined) return;

    let operation: DispatchOperation | undefined;
    requestHost.dispatchOperation = (spec) => {
      if (this.#disposed) {
        return Promise.resolve({
          notStarted: true,
          reason: "the runtime is shutting down and is no longer dispatching work"
        });
      }
      operation ??= this.#buildDispatchOperation(runtimeConfig, stores);
      return operation(spec);
    };
  }

  /**
   * The host the request-host operations dispatch through, built on first use
   * and shared between the detached start and the dispatch seam.
   *
   * Built lazily so everything it reads — the worker's dispatcher, the shared
   * arbiter — is resolved by the time it runs, rather than captured at a moment
   * when the worker adapter has not been consulted yet.
   *
   * Shared rather than one per operation because a second host in this process
   * would be a second place the same questions get answered — which dispatcher
   * is effective, whether it is external — and two answers to one question is
   * how a seam and a dispatch branch come to disagree. The arbiter is already
   * shared for exactly that reason.
   */
  #hostForRequestHostOperations(
    runtimeConfig: RuntimeConfig,
    stores: StoreRegistry
  ): InboundTransportHost {
    this.#requestHostOperationsHost ??= createInboundTransportHost({
      registry: this.#registry,
      stores,
      // Never consulted by `dispatch` — a detached or dispatched envelope
      // carries a server-derived principal — but it is what the router would
      // pass, so the host is not subtly different from the one HTTP gets.
      resolvePrincipal:
        this.#options.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver,
      runtimeConfig,
      dispatcher: this.#options.dispatcher ?? this.#workerDispatcher,
      // One arbiter across every host in the process — see `#arbiter`.
      arbiter: this.#arbiter
    });
    return this.#requestHostOperationsHost;
  }

  /**
   * Build the dispatch seam's operation, on first use. A dispatched child that
   * runs here is tracked for the shutdown drain, keyed on the effective
   * dispatcher.
   */
  #buildDispatchOperation(runtimeConfig: RuntimeConfig, stores: StoreRegistry): DispatchOperation {
    const dispatcher = this.#options.dispatcher ?? this.#workerDispatcher;
    const host = this.#hostForRequestHostOperations(runtimeConfig, stores);
    const runsHere = isInProcessDispatcher(dispatcher);
    return createDispatchOperation({
      host,
      ...(runsHere
        ? { onDispatched: (child: DispatchedChild) => this.#trackDetachedChild(child) }
        : {})
    });
  }

  /**
   * Hold a detached child's completion until it settles, so `dispose()` can wait
   * for it. Self-removing, so a long-lived server does not accumulate entries.
   *
   * The rejection is swallowed **on the tracking chain only** — the original
   * promise is what `dispose()` awaits, and the host has already marked it
   * handled. Without the `catch` here, the `finally` link would itself reject
   * and become the unhandled rejection this is meant to avoid.
   */
  #trackDetachedChild(child: DispatchedChild): void {
    this.#dispatchedChildren.add(child);
    void child.finished
      .catch(() => undefined)
      .finally(() => this.#dispatchedChildren.delete(child));
  }

  async #doInit(): Promise<FlowApiRouter> {
    const { registry, stores, runtimeConfig } = await this.#runtime();

    // The SECOND of the two places the sweep cadence reaches the shared config,
    // and the one that covers a caller who resolved the runtime first:
    // `getRuntime()` builds and memoizes it with `#routerRequested` still
    // false, so the stamp in `#buildRuntime` did not happen and this is the
    // only chance. When `ready()` / `getRouter()` is the entry point instead,
    // `#buildRuntime` already stamped the identical value and this is a no-op —
    // both sides resolve it from `this.#options` through `resolveStaleSweep`.
    //
    // Mutating the shared object rather than replacing it is what makes the
    // fact reach the worker at all: `worker.startWorker(runtime)` captured this
    // exact reference, and `createExecutionContext` reads the cadence per
    // request, so the worker's next job sees it.
    //
    // A host that only ever calls `getRuntime()` never reaches this line and
    // keeps the named refusal (`runtime-only-liveness.test.ts`).
    if (runtimeConfig.requestHost !== undefined) {
      runtimeConfig.requestHost.staleSweepIntervalMs =
        resolveStaleSweep(this.#options).staleSweepIntervalMs;
    }

    return createFlowApiRouter({
      registry,
      stores,
      runtimeConfig,
      onError: this.#options.onError,
      detectInterruptedOnStartup: this.#options.detectInterruptedOnStartup,
      adapters: this.#options.adapters,
      resolvePrincipal: this.#options.resolvePrincipal,
      debugEndpointsEnabled: this.#options.debugEndpointsEnabled,
      staleSweepIntervalMs: this.#options.staleSweepIntervalMs,
      staleSweepThresholdMs: this.#options.staleSweepThresholdMs,
      queuedGraceMs: this.#options.queuedGraceMs,
      dispatcher: this.#options.dispatcher ?? this.#workerDispatcher,
      // The same arbiter the detached-start host uses, so one flow-level
      // concurrency policy is enforced once across the process — see `#arbiter`.
      arbiter: this.#arbiter
    });
  }
}

/**
 * Assemble a flow-state runtime from declarative config. Returns a
 * {@link FlowState} handle whose router initializes lazily on first request.
 * Throws {@link FlowStateConfigError} synchronously for an empty `stores`
 * map or an unknown `defaultProfile`.
 */
export function createFlowState<
  TSettings extends object = FlowStateSettings
>(options: CreateFlowStateOptions<TSettings>): FlowState<TSettings> {
  return new InternalFlowState<TSettings>(options);
}

/**
 * Structural check for a {@link FlowState} handle. Deliberately structural
 * rather than `instanceof InternalFlowState`: a config file or consumer repo
 * may resolve `@flow-state-dev/engine` to a duplicated package instance
 * (workspace symlinks, double installs), so an identity check would reject a
 * valid handle built by a different copy of the class. Checks the four methods
 * that define the off-transport contract (`getRuntime`/`getRouter`) plus the
 * lifecycle pair (`ready`/`dispose`), which together separate a FlowState from
 * a raw `FlowApiRouter`.
 */
export function isFlowState(value: unknown): value is FlowState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FlowState).getRuntime === "function" &&
    typeof (value as FlowState).getRouter === "function" &&
    typeof (value as FlowState).ready === "function" &&
    typeof (value as FlowState).dispose === "function"
  );
}
