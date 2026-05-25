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
  ResolveAiSdkSpeechModel,
  ResolveAiSdkTranscriptionModel
} from "@flow-state-dev/core";
import type { CreateFlowApiRouterOptions, FlowApiRouter } from "../routes/createFlowApiRouter";
import type { CapabilitySlot, StoresConfig } from "../stores/store-adapter";

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
 * Voice providers. The framework wraps these with the AI-SDK resolver
 * adapters automatically; pass `openai.speech` / `openai.transcription`
 * directly. Provisional shape — revisited when FIX-528's `VoiceProvider`
 * lands (the field name stays; only the value type changes).
 */
export interface FlowStateVoiceConfig {
  speech?: ResolveAiSdkSpeechModel;
  transcription?: ResolveAiSdkTranscriptionModel;
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
  debugEndpointsEnabled?: boolean;
  defaultSseHeartbeatMs?: number;
}

/**
 * The handle returned by `createFlowState`. The runtime router is built
 * lazily on first `getRouter()` / `ready()`; adapters open pools then.
 */
export interface FlowState<TSettings extends object = FlowStateSettings> {
  /** Resolve the lazy router. First call triggers async store init. */
  getRouter(): Promise<FlowApiRouter>;

  /** Eager warmup. Idempotent. Useful in `instrumentation.ts` / tests. */
  ready(): Promise<void>;

  /** Dispose pooled resources across every declared adapter. */
  dispose(): Promise<void>;

  /** The active profile name. Resolved on first `ready()` / `getRouter()`. */
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
