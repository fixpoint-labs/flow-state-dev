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
  createAiSdkSpeechResolver,
  createAiSdkTranscriptionResolver,
  type CreateModelResolverOptions,
  type FlowStateSettings
} from "@flow-state-dev/core";
import { createFlowRegistry, type FlowRegistry } from "../registry/flow-registry";
import { createFlowApiRouter, type FlowApiRouter } from "../routes/createFlowApiRouter";
import { FlowStateConfigError, FlowStateDisposedError } from "../errors/flow-error";
import type { CapabilitySlot, StoreAdapter, StoresConfig } from "../stores/store-adapter";
import { resolveProfileStores } from "./resolve-slots";
import type {
  CreateFlowStateOptions,
  FlowState,
  FlowStateModelsConfig
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
  #initPromise: Promise<FlowApiRouter> | null = null;
  #disposed = false;

  constructor(options: CreateFlowStateOptions<TSettings>) {
    this.#options = options;
    this.#profileKeys = Object.keys(options.stores);

    if (this.#profileKeys.length === 0) {
      throw new FlowStateConfigError(
        "createFlowState: stores must declare at least one profile"
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
      declaredSlots: declaredSlots(this.#options.stores)
    };
  }

  ready(): Promise<void> {
    return this.#init().then(() => undefined);
  }

  getRouter(): Promise<FlowApiRouter> {
    return this.#init();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    // Let an in-flight init settle so adapters that opened pools mid-init
    // still get a clean dispose. A failed init is swallowed here — disposal
    // must proceed regardless.
    if (this.#initPromise !== null) {
      try {
        await this.#initPromise;
      } catch {
        // init failed; adapters may still hold partially-opened resources.
      }
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
      this.#initPromise = this.#doInit();
    }
    return this.#initPromise;
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

  async #doInit(): Promise<FlowApiRouter> {
    const profileName = this.#resolveProfileName();
    const profile = this.#options.stores[profileName]!;
    const { stores } = await resolveProfileStores({ profileName, profile });

    // eslint-disable-next-line no-console
    console.log(`[flowstate] active profile: "${profileName}"`);

    const modelResolver =
      this.#options.modelResolver ??
      createModelResolver(toModelResolverOptions(this.#options.models));
    const speechResolver = this.#options.voice?.speech
      ? createAiSdkSpeechResolver(this.#options.voice.speech)
      : undefined;
    const transcriptionResolver = this.#options.voice?.transcription
      ? createAiSdkTranscriptionResolver(this.#options.voice.transcription)
      : undefined;

    return createFlowApiRouter({
      registry: this.#registry,
      stores,
      modelResolver,
      speechResolver,
      transcriptionResolver,
      settings: this.#options.settings as FlowStateSettings | undefined,
      onError: this.#options.onError,
      onBackgroundWork: this.#options.onBackgroundWork,
      detectInterruptedOnStartup: this.#options.detectInterruptedOnStartup,
      middleware: this.#options.middleware,
      adapters: this.#options.adapters,
      debugEndpointsEnabled: this.#options.debugEndpointsEnabled,
      defaultSseHeartbeatMs: this.#options.defaultSseHeartbeatMs
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
