/**
 * Public types for `createFlowState` — the single user-facing entry point
 * that assembles a flow-state runtime from declarative configuration.
 *
 * `CreateFlowStateOptions` is the config object; `FlowState` is the returned
 * handle (lazy router, eager warmup, disposal, diagnostics). The factory and
 * its internal class live in `createFlowState.ts`.
 */
import type {
  CreateModelResolverOptions,
  FlowInstance,
  FlowStateSettings,
  VoiceProvider
} from "@flow-state-dev/core";
import type { CreateFlowApiRouterOptions, FlowApiRouter } from "../routes/createFlowApiRouter";
import type { FlowDispatcher } from "../transports/dispatcher";
import type { CapabilitySlot, StoresConfig } from "../stores/store-adapter";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeConfig } from "../runtime-config";

/** Model-resolver config, re-shaped for the FlowState surface. */
export interface FlowStateModelsConfig {
  /** Concrete fallback model when an `intent/<name>` string can't resolve. */
  default?: string;
  /** Named intent ladders — each is an ordered list of candidate model ids. */
  intents?: Record<string, string[]>;
  gateways?: CreateModelResolverOptions["gateways"];
  retryPolicy?: CreateModelResolverOptions["retryPolicy"];
  providers?: CreateModelResolverOptions["providers"];
  providerPreference?: CreateModelResolverOptions["providerPreference"];
  keys?: CreateModelResolverOptions["keys"];
}

/**
 * Voice configuration for the runtime. The user instantiates a provider class
 * (e.g. `new OpenAIVoiceProvider({ apiKey })`) and passes the instance; the
 * router and TTS pipeline dispatch through it.
 */
export interface FlowStateVoiceConfig {
  /** Voice provider for TTS and STT. */
  provider?: VoiceProvider;
}

/**
 * Which sides of an execution backend this process runs.
 *
 * - `"colocated"` — dispatch and process in one process. The local-dev
 *   default: actions route through the backend's queue and a worker in the
 *   same process consumes them against the same resolved runtime.
 * - `"dispatch-only"` — enqueue only (the web process in a separated
 *   deployment). A dedicated worker process consumes the queue.
 * - `"worker-only"` — process only (a dedicated worker container). Build
 *   the same `createFlowState(...)` from shared config and call `ready()`;
 *   no dispatcher is installed and the router is typically never served.
 */
export type WorkerMode = "colocated" | "dispatch-only" | "worker-only";

/** Handle for a started worker; `close()` drains and stops it. */
export interface WorkerHandle {
  close(): Promise<void>;
}

/**
 * An execution-backend adapter for the `worker` option of `createFlowState`.
 *
 * Adapter packages (e.g. `@flow-state-dev/bullmq`) return an object whose
 * shape satisfies this interface. `createFlowState` resolves the runtime
 * once and hands the SAME `{ registry, stores, runtimeConfig }` to both
 * sides, so the dispatch path and the worker can never disagree on stores —
 * the invariant that makes streaming, refresh, and the devtool read what
 * the worker writes.
 */
export interface WorkerAdapter {
  /** Which sides this process runs. Default `"colocated"`. */
  readonly mode?: WorkerMode;
  /**
   * Build the dispatch side (enqueue + live-event bridge). Installed as the
   * router's `FlowDispatcher` unless mode is `"worker-only"`.
   */
  createDispatcher(runtime: FlowStateRuntime): FlowDispatcher;
  /**
   * Start the processing side against the resolved runtime. Called during
   * runtime init unless mode is `"dispatch-only"`. The returned handle is
   * closed by `FlowState.dispose()` before store adapters are disposed, so
   * in-flight jobs drain against open stores.
   */
  startWorker(runtime: FlowStateRuntime): WorkerHandle;
  /** Release backend resources (queues, connections). Called by `dispose()`. */
  close?(): Promise<void>;
}

export interface CreateFlowStateOptions<
  TSettings extends object = FlowStateSettings
> {
  /** Flows to register. Map of stable keys to flow instances. */
  flows: Record<string, FlowInstance<any, any>>;

  /** Model resolver config. Auto-wires AI Gateway via `AI_GATEWAY_API_KEY`. */
  models?: FlowStateModelsConfig;

  /**
   * Escape hatch: a pre-built model resolver. When provided, it is used
   * instead of building one from `models` — for test mocks
   * (`createMockModelResolver`) or fully custom resolvers.
   */
  modelResolver?: CreateFlowApiRouterOptions["modelResolver"];

  /** Voice providers (speech / transcription). */
  voice?: FlowStateVoiceConfig;

  /**
   * Named stores profiles, each a map of capability slots. At least one
   * profile must be declared. Single-profile users typically use
   * `{ default: ... }`.
   */
  stores: StoresConfig;

  /**
   * Which profile is active at runtime. Resolution chain (first match wins):
   * `process.env.FSD_ENV` → this value → first declared profile. `NODE_ENV`
   * is intentionally not consulted.
   */
  defaultProfile?: string;

  /**
   * Instance-level configuration read inside blocks via `ctx.settings`.
   * Typed via the `TSettings` generic (declaration-merged in user code into
   * the `FlowStateSettings` interface).
   */
  settings?: TSettings;

  /** HTTP-level error sink. Receives `{ method, path }` context. */
  onError?: CreateFlowApiRouterOptions["onError"];

  /**
   * Opt-in error-capture sink (FIX-724). Routes runtime block failures (tool
   * errors, generator failures, handler exceptions) to an external
   * observability service. Distinct from `onError`, which is an HTTP-level sink:
   * `errorCapture` is block-aware and receives the failing block's identity plus
   * the flow / request / session / user IDs. Provider-neutral — the operator
   * writes the adapter; the framework ships no provider SDK. Off by default.
   */
  errorCapture?: CreateFlowApiRouterOptions["errorCapture"];

  /**
   * Background-work keep-alive hook. On serverless platforms that freeze the
   * function after the response (Vercel), pass the platform's post-response
   * primitive — e.g. `(p) => after(() => p)` from `next/server` — so
   * fire-and-forget work (scheduled dispatches, post-202 action execution)
   * isn't killed mid-flight. Platform-agnostic, so it's a `createFlowState`
   * option rather than baked into an adapter: the router is built here, and a
   * downstream handler can't inject it after construction.
   */
  onBackgroundWork?: CreateFlowApiRouterOptions["onBackgroundWork"];

  /**
   * Whether to detect interrupted requests from previous runs on startup.
   * Disable on serverless (background queries on cold start can exhaust the
   * pool before real requests are served). Default: true.
   */
  detectInterruptedOnStartup?: boolean;

  /** Forwarded to `createFlowApiRouter` for power users (custom transports). */
  middleware?: CreateFlowApiRouterOptions["middleware"];
  adapters?: CreateFlowApiRouterOptions["adapters"];

  /**
   * Host-level fallback principal resolver, used when an inbound flow has no
   * `authentication.resolvePrincipal` of its own. Per-flow auth always wins.
   */
  resolvePrincipal?: CreateFlowApiRouterOptions["resolvePrincipal"];

  debugEndpointsEnabled?: boolean;
  defaultSseHeartbeatMs?: number;

  /** Stale-request sweeper cadence (ms). 0 disables. Default 30000. */
  staleSweepIntervalMs?: number;
  /** Heartbeat-age threshold (ms) for the stale-request sweeper. Default 60000. */
  staleSweepThresholdMs?: number;

  /**
   * Retention policy for the durability sweeper (FIX-141). Only takes effect
   * alongside a configured `durabilityProvider`. Enforces suspension expiry and
   * prunes aged-out suspensions, leases, and orphaned checkpoints on a cadence.
   */
  durabilityRetention?: RuntimeConfig["durabilityRetention"];
  
  /**
   * Low-level escape hatch: a pre-built FlowDispatcher controlling where
   * flow actions execute. Default: in-process (runAction called directly).
   * Most deployments should use `worker` instead — it wires the dispatcher
   * AND the processing side from one adapter. Mutually exclusive with
   * `worker`.
   */
  dispatcher?: FlowDispatcher;

  /**
   * Execution-backend adapter (e.g. `bullmqWorker(...)` from
   * `@flow-state-dev/bullmq`). Wires the dispatch side and/or the worker
   * side per the adapter's `mode`, both against the same resolved runtime.
   * Worker startup happens on first `ready()` / `getRouter()` /
   * `getRuntime()` — call `ready()` eagerly in processes that must consume
   * the queue from boot. Mutually exclusive with `dispatcher`.
   */
  worker?: WorkerAdapter;
}

/**
 * The runtime internals of a {@link FlowState}, resolved alongside the router.
 * Off-transport consumers — background workers, queue processors, scripts —
 * need these directly rather than reaching through the HTTP router. The shape
 * is exactly what a worker runtime's `createWorker(deps)` consumes.
 */
export interface FlowStateRuntime {
  /** The flow registry built from the configured `flows`. */
  registry: FlowRegistry;
  /** The resolved store registry for the active profile; stores are open. */
  stores: StoreRegistry;
  /** The forwarded instance-level runtime configuration bundle. */
  runtimeConfig: RuntimeConfig;
}

/**
 * The handle returned by `createFlowState`. The runtime router is built
 * lazily on first `getRouter()` / `ready()`; adapters open pools then.
 */
export interface FlowState<TSettings extends object = FlowStateSettings> {
  /** Resolve the lazy router. First call triggers async store init. */
  getRouter(): Promise<FlowApiRouter>;

  /**
   * Resolve the runtime internals for off-transport consumers (background
   * workers, queue processors, scripts). Triggers async store init like
   * `getRouter()` and is idempotent and memoized — it returns the same
   * `{ registry, stores, runtimeConfig }` instances the router uses.
   */
  getRuntime(): Promise<FlowStateRuntime>;

  /** Eager warmup. Idempotent. Useful in `instrumentation.ts` / tests. */
  ready(): Promise<void>;

  /** Dispose pooled resources across every declared adapter. */
  dispose(): Promise<void>;

  /**
   * The active profile name. Resolved on first `ready()` / `getRouter()`.
   * Reading it earlier resolves the profile eagerly and throws
   * `FlowStateConfigError` if `FSD_ENV` names a profile that wasn't declared.
   */
  readonly activeProfile: string;

  /** The settings bag, typed via `TSettings`. Read-only at runtime. */
  readonly settings: TSettings;

  /** Diagnostic metadata. */
  readonly meta: {
    flowKeys: string[];
    profileKeys: string[];
    declaredSlots: Record<string, CapabilitySlot[]>;
  };
}
