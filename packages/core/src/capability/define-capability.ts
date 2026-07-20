/**
 * defineCapability() factory — creates a branded capability descriptor.
 *
 * Follows the defineResource() pattern: returns the config object branded
 * with phantom types for downstream type inference. The same reference is
 * reused across blocks, enabling diamond-dependency deduplication via ===.
 */
import type { DeclaredResourceEntry } from "../types/block";
import { getBaseCapability } from "./merge";
import type {
  CapabilityConfig,
  CapabilityConfigResolveCtx,
  ConfiguredCapability,
  DefinedCapability,
  InferSessionState,
  PresetDef,
  PresetOverrides,
} from "./types";

export function defineCapability<
  const TName extends string,
  const TFns extends Record<string, (...args: any[]) => any> = Record<string, never>,
  const TSessionStateSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TResources extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  const TTargetSchemas extends Record<string, import("zod").ZodTypeAny> | undefined = undefined,
  const TSequencerStateSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TPresetKeys extends string = never,
  const TSessionStateType = unknown,
  const TResourcesType = unknown,
  const TTargetStatesType = unknown,
  const TSequencerStateType = unknown,
  const TConfigSchema extends import("zod").ZodTypeAny | undefined = undefined,
  const TConfigExplicit = never,
>(
  config: Omit<CapabilityConfig<
    TName,
    TFns,
    TSessionStateSchema,
    TResources,
    TTargetSchemas,
    TSequencerStateSchema
  >, "config"> & {
    presets?: { [K in TPresetKeys]: PresetDef<InferSessionState<TSessionStateSchema>> | string[] } & { default?: string[] };
    // Capture the literal override type via const generics so the
    // InferCapability* utilities can read it via `infer O`. Without this,
    // the field on CapabilityConfig is typed `unknown` and `infer` widens
    // to `unknown`, which makes the override branch a no-op.
    sessionStateType?: TSessionStateType;
    resourcesType?: TResourcesType;
    targetStatesType?: TTargetStatesType;
    sequencerStateType?: TSequencerStateType;
    // Open config. `schema` types the resolver's `config` param as z.output
    // (parsed) and the `.config()` argument as z.input. Schemaless: both are
    // the explicit type inferred from the resolver's `config` annotation.
    config?: {
      schema?: TConfigSchema;
      resolve: (
        config: TConfigSchema extends import("zod").ZodTypeAny
          ? import("zod").output<TConfigSchema>
          : TConfigExplicit,
        ctx: CapabilityConfigResolveCtx
      ) => Partial<PresetDef<InferSessionState<TSessionStateSchema>>>;
    };
  }
): DefinedCapability<
  TName,
  TFns,
  TPresetKeys,
  Record<string, PresetDef>,
  TSessionStateSchema,
  TResources,
  TTargetSchemas,
  TSequencerStateSchema
> & {
  readonly sessionStateType?: TSessionStateType;
  readonly resourcesType?: TResourcesType;
  readonly targetStatesType?: TTargetStatesType;
  readonly sequencerStateType?: TSequencerStateType;
  // z.input at the call site (a `.default()` field is optional here); `never`
  // when no config is declared, which makes `.config()` a compile error.
  readonly __configInType?: TConfigSchema extends import("zod").ZodTypeAny
    ? import("zod").input<TConfigSchema>
    : TConfigExplicit;
} {
  if (!config.name || config.name.trim() === "") {
    throw new Error("defineCapability() requires a non-empty name");
  }

  // Build the runtime object: copy config fields, move presets to __presetDefs,
  // replace presets with the builder method.
  const capability: any = {
    __brand: "Capability" as const,
    name: config.name,
    resources: config.resources,
    sessionStateSchema: config.sessionStateSchema,
    requestStateSchema: config.requestStateSchema,
    userStateSchema: config.userStateSchema,
    orgStateSchema: config.orgStateSchema,
    sequencerStateSchema: config.sequencerStateSchema,
    targetStateSchemas: config.targetStateSchemas,
    uses: config.uses,
    itemVisibility: config.itemVisibility,
    fns: config.fns,
    __presetDefs: config.presets,
    __configDef: config.config,
  };

  // Both builders route through createConfiguredRef so a single Object.create()
  // clone (one hop from the base) carries both __presetOverrides and __config.
  // getBaseCapability() recovers the base via Object.getPrototypeOf() for
  // diamond-dependency deduplication regardless of chain order.
  capability.presets = function presetsBuilder(
    this: any,
    overrides: PresetOverrides<string, Record<string, PresetDef>>
  ): ConfiguredCapability {
    return createConfiguredRef(this, { __presetOverrides: overrides });
  };
  capability.config = function configBuilder(this: any, value: unknown): ConfiguredCapability {
    return createConfiguredRef(this, { __config: value });
  };

  return capability;
}

/**
 * Produce a configured capability reference one hop from the base.
 *
 * `receiver` is the ref the builder was called on (`this`) — the base itself,
 * or an already-configured clone. The result always prototypes off the base
 * (single hop, so diamond dedup by identity still works) and copies forward any
 * sibling carrier the receiver already had, so `.config().presets()` and
 * `.presets().config()` both end with one clone holding both fields.
 */
function createConfiguredRef(
  receiver: any,
  patch: { __presetOverrides?: unknown } | { __config?: unknown }
): any {
  const base = getBaseCapability(receiver);
  const configured = Object.create(base);
  if ("__presetOverrides" in receiver) {
    configured.__presetOverrides = receiver.__presetOverrides;
  }
  if ("__config" in receiver) {
    configured.__config = receiver.__config;
  }
  Object.assign(configured, patch);
  return configured;
}
