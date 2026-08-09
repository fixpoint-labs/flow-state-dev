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
import { createRuntimeConfig, resolveStaleSweep } from "../runtime-config";
import { createCheckpointDurabilityProvider } from "../durability/checkpoint-durability-provider";
import { FlowStateConfigError, FlowStateDisposedError } from "../errors/flow-error";
import type { CapabilitySlot, StoreAdapter, StoresConfig } from "../stores/store-adapter";
import { resolveProfileStores } from "./resolve-slots";
import type { FlowDispatcher } from "../transports/dispatcher";
import type {
  CreateFlowStateOptions,
  FlowState,
  FlowStateModelsConfig,
  FlowStateRuntime,
  WorkerHandle
} from "./types";

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
    // and the sweeper cannot describe different cadences. `startOperation` and
    // `parentTask` stay unwired here: no host start operation exists yet, and
    // the verb refuses by name rather than pretending otherwise.
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
      requestHost: {
        staleThresholdMs,
        ...(this.#routerRequested ? { staleSweepIntervalMs } : {})
      }
    });

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
    if (worker !== undefined) {
      const mode = worker.mode ?? "colocated";
      if (mode !== "worker-only") {
        this.#workerDispatcher = worker.createDispatcher(runtime);
      }
      if (mode !== "dispatch-only") {
        this.#workerHandle = worker.startWorker(runtime);
      }
    }

    return runtime;
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
      dispatcher: this.#options.dispatcher ?? this.#workerDispatcher
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
