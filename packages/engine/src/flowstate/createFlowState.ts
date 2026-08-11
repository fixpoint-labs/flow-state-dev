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
import { DEFAULT_RUNTIME_LOGGER, logRuntimeEvent } from "../execution/logging";
import { abortRequest } from "../execution/abort-registry";
import { createCheckpointDurabilityProvider } from "../durability/checkpoint-durability-provider";
import { FlowStateConfigError, FlowStateDisposedError } from "../errors/flow-error";
import type { CapabilitySlot, StoreAdapter, StoresConfig } from "../stores/store-adapter";
import { resolveProfileStores } from "./resolve-slots";
import type { FlowDispatcher } from "../transports/dispatcher";
import {
  createDetachedStartOperation,
  type DispatchedDetachedChild
} from "../context/detached-start-operation";
import type { DetachedStartOperation } from "../context/create-request-host";
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
 * is carved out of `detachedDrainTimeoutMs` so the option stays a true ceiling.
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
 * Resolve the drain budget, rejecting values that cannot bound anything.
 *
 * `NaN` is what `Number(process.env.X)` yields from a typo, and every comparison
 * against it is false — the deadline would never be considered reached, which is
 * precisely the hang this bound exists to remove. A negative or zero budget is
 * honoured as "do not wait": that is a legitimate choice for a host that wants
 * shutdown to be immediate, and it still reports what it left behind.
 */
function resolveDetachedDrainTimeout(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured)) {
    return DEFAULT_DETACHED_DRAIN_TIMEOUT_MS;
  }
  return Math.max(0, configured);
}

/**
 * Resolve `true` when `work` settles within `ms`, `false` when the budget runs
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
function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), ms);
    void work.then(
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
   * In-process detached children still running, drained by `dispose()`.
   *
   * Only ever populated by the start operation `#installDetachedStart` installs
   * — a queue-backed child runs in another process and is not this one's to wait
   * for. Entries remove themselves when they settle, so a long-lived server does
   * not accumulate them.
   */
  readonly #detachedChildren = new Set<DispatchedDetachedChild>();
  /**
   * The resolved runtime config, kept so `dispose()` can read the logger a host
   * configured. Held as the object rather than the logger value: a host may
   * install one after `getRuntime()` returns.
   */
  #resolvedRuntimeConfig: RuntimeConfig | undefined;
  /**
   * The one concurrency arbiter every host in this process shares (FIX-1077).
   *
   * Two hosts exist in a router deployment — the one the detached start
   * operation is built over, and the router's. Each would otherwise own a
   * private keyed gate, so a Workstream spawned by an HTTP request could start
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
    await this.#drainDetachedChildren();

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
   * a Workstream blocked on an external call — meant the `await` never returned,
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
    if (this.#detachedChildren.size === 0) return;

    const budgetMs = resolveDetachedDrainTimeout(this.#options.detachedDrainTimeoutMs);
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
      this.#detachedChildren.size > 0 && round < MAX_DETACHED_DRAIN_ROUNDS;
      round += 1
    ) {
      const remainingMs = waitDeadline - Date.now();
      if (remainingMs <= 0) break;

      const pending = [...this.#detachedChildren];
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
        `[flowstate] waiting for ${pending.length} detached request(s) to finish before shutdown`,
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

    if (this.#detachedChildren.size > 0) {
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
   * fits inside `detachedDrainTimeoutMs` rather than overrunning it by a
   * constant. A child that ignores its abort signal therefore cannot re-open the
   * hang this method exists to close, and a `0` budget cancels and returns
   * without waiting at all.
   */
  async #cancelOutstandingChildren(
    deadline: number,
    startedAt: number,
    budgetMs: number
  ): Promise<void> {
    const abandoned = [...this.#detachedChildren];

    for (const child of abandoned) {
      // Best-effort by contract: `false` means the run already deregistered,
      // which is a race we win by doing nothing.
      abortRequest(child.requestId);
    }

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
    abandoned: readonly DispatchedDetachedChild[],
    elapsedMs: number,
    budgetMs: number
  ): void {
    const named = abandoned
      .slice(0, MAX_NAMED_TRUNCATED_CHILDREN)
      .map((child) => `${child.requestId} (session ${child.sessionId})`)
      .join(", ");
    const overflow = abandoned.length - MAX_NAMED_TRUNCATED_CHILDREN;

    console.error(
      `[flowstate] shutdown cancelled ${abandoned.length} detached request(s) ` +
        `after ${elapsedMs}ms (budget ${budgetMs}ms); they may not have completed: ` +
        `${named}${overflow > 0 ? `, and ${overflow} more` : ""}`
    );
  }

  /**
   * Emit a shutdown diagnostic through the runtime's configured logger.
   *
   * Read from the runtime config at call time rather than captured, because a
   * host may install its logger after resolving the runtime — the CLI does
   * exactly that, which is how `--quiet` reaches a line written during
   * `dispose()`. Falls back to the framework default so a deployment that
   * configures nothing still sees it.
   */
  #logShutdown(
    level: "warn",
    message: string,
    context: Record<string, unknown>
  ): void {
    logRuntimeEvent(
      this.#resolvedRuntimeConfig?.logger ?? DEFAULT_RUNTIME_LOGGER,
      level,
      message,
      context
    );
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
    // and the sweeper cannot describe different cadences. `startOperation` is
    // wired at the bottom of this method, once the dispatcher it must go
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
      maxWorkstreamListLimit: this.#options.maxWorkstreamListLimit,
      requestHost: {
        staleThresholdMs,
        ...(this.#routerRequested ? { staleSweepIntervalMs } : {})
      }
    });

    this.#resolvedRuntimeConfig = runtimeConfig;

    // BEFORE the worker wiring and before any router exists, so every later copy
    // of `requestHost` carries it. See `#installDetachedStart`.
    this.#installDetachedStart(runtimeConfig, stores);

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
   * Install the detached start operation on the SHARED runtime config, once.
   *
   * ## Why this is the only installer that matters
   *
   * `startOperation` is a mutation of an object that exists in more than one
   * copy, and that is the whole bug class this method closes. `createFlowApiRouter`
   * does not mutate the config it is given — it builds a fresh `requestHost`
   * literal (`{ ...base.requestHost, staleThresholdMs, staleSweepIntervalMs }`).
   * That spread is a **fork**: anything stamped after it is router-local by
   * construction. `createFlowRouteHandlers` then stamped the operation onto that
   * fork, which nobody else holds — so the object handed to
   * `worker.startWorker(runtime)` never got one, and a colocated queue worker
   * running a detached board met `no-start-operation`.
   *
   * Installing here, at config construction, inverts it: the shared object
   * carries the operation from birth, so the router's fork and the worker's
   * reference both inherit it by spread and there is nothing left to stamp
   * afterwards. The same move `#buildRuntime` already documents for the rest of
   * the seam ("belongs on the SHARED config, not on the router's copy of it"),
   * finally applied to the field that was left behind.
   *
   * ## Lazy, because the host is the expensive part
   *
   * The operation dispatches through an `InboundTransportHost`, and a deployment
   * that never detaches should not pay to build one. Deferring construction to
   * the first call also removes the ordering constraint that forced the previous
   * version to run *after* the worker wiring: the dispatcher is read when the
   * call happens, by which time `#workerDispatcher` and any router are resolved.
   * Installing eagerly at construction and resolving lazily at use is what lets
   * one assignment be both early enough for every copy and late enough for every
   * dependency.
   *
   * ## Every topology, including `worker-only`
   *
   * An earlier version skipped `worker-only` on the reasoning that a host built
   * there would run detached work in-process instead of enqueuing it. That is
   * true and it is better than refusing: the colocated and worker-only bullmq
   * topologies are documented as supported, and a topology that claims support
   * while refusing detached work is not supporting it. The child runs on the
   * worker rather than through the queue, so it is not durable the way an
   * enqueued job is — a queue-backed start operation owned by the queue's own
   * adapter remains the better answer (FIX-1069), and this is what the feature
   * does until that exists rather than nothing at all.
   *
   * A start operation already on the config is still never overwritten: a
   * deployment that wired its own is the more specific answer.
   */
  #installDetachedStart(runtimeConfig: RuntimeConfig, stores: StoreRegistry): void {
    const requestHost = runtimeConfig.requestHost;
    if (requestHost === undefined) return;
    if (requestHost.startOperation !== undefined) return;

    let operation: DetachedStartOperation | undefined;
    requestHost.startOperation = (spec) => {
      operation ??= this.#buildDetachedStartOperation(runtimeConfig, stores);
      return operation(spec);
    };
  }

  /**
   * Build the host and the operation it dispatches through, on first use.
   *
   * Split from the install so everything it reads — the worker's dispatcher, the
   * shared arbiter — is resolved by the time it runs, rather than captured at a
   * moment when the worker adapter has not been consulted yet.
   */
  #buildDetachedStartOperation(
    runtimeConfig: RuntimeConfig,
    stores: StoreRegistry
  ): DetachedStartOperation {
    const dispatcher = this.#options.dispatcher ?? this.#workerDispatcher;

    const host = createInboundTransportHost({
      registry: this.#registry,
      stores,
      // Never consulted by `dispatch` — a detached envelope carries a
      // server-derived principal — but it is what the router would pass, so the
      // host is not subtly different from the one HTTP gets.
      resolvePrincipal:
        this.#options.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver,
      runtimeConfig,
      dispatcher,
      // One arbiter across every host in the process — see `#arbiter`.
      arbiter: this.#arbiter
    });

    // Track children for the shutdown drain ONLY when they run here.
    //
    // The drain exists because truncating in-process work strands it: nothing
    // else is holding the run, so a closed store mid-write leaves a task row
    // `in_progress` forever. An externally dispatched child is a different
    // situation: the enqueue is confirmed before `startDetached` returns, so
    // there is no half-written row to strand, and `finished` there resolves only
    // when some worker completes the job — waiting would block `dispose()` on a
    // process this one does not control, indefinitely in a topology where the
    // workers live elsewhere.
    //
    // Keyed on the effective DISPATCHER rather than on `worker.mode`, because the
    // two genuinely disagree: `options.dispatcher` (mutually exclusive with
    // `worker`, so `mode` reads as its `colocated` default) can be external, and
    // a custom dispatcher exposing `dispatchLocal` is local whatever the mode
    // says. `isInProcessDispatcher` is the host's own test, shared so this and
    // the dispatch branch cannot come to different conclusions.
    const runsHere = isInProcessDispatcher(dispatcher);

    return createDetachedStartOperation({
      host,
      ...(runsHere
        ? { onDispatched: (child: DispatchedDetachedChild) => this.#trackDetachedChild(child) }
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
  #trackDetachedChild(child: DispatchedDetachedChild): void {
    this.#detachedChildren.add(child);
    void child.finished
      .catch(() => undefined)
      .finally(() => this.#detachedChildren.delete(child));
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
