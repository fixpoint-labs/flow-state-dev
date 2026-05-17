/**
 * defineCapability() factory — creates a branded capability descriptor.
 *
 * Follows the defineResource() pattern: returns the config object branded
 * with phantom types for downstream type inference. The same reference is
 * reused across blocks, enabling diamond-dependency deduplication via ===.
 */
import type { DeclaredResourceEntry } from "../types/block";
import type {
  CapabilityConfig,
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
>(
  config: CapabilityConfig<
    TName,
    TFns,
    TSessionStateSchema,
    TResources,
    TTargetSchemas,
    TSequencerStateSchema
  > & {
    presets?: { [K in TPresetKeys]: PresetDef<InferSessionState<TSessionStateSchema>> | string[] } & { default?: string[] };
    // Capture the literal override type via const generics so the
    // InferCapability* utilities can read it via `infer O`. Without this,
    // the field on CapabilityConfig is typed `unknown` and `infer` widens
    // to `unknown`, which makes the override branch a no-op.
    sessionStateType?: TSessionStateType;
    resourcesType?: TResourcesType;
    targetStatesType?: TTargetStatesType;
    sequencerStateType?: TSequencerStateType;
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
    agentType: config.agentType,
    fns: config.fns,
    __presetDefs: config.presets,
  };

  // .presets() uses Object.create() so getBaseCapability() can recover this
  // reference via Object.getPrototypeOf() for diamond-dependency deduplication.
  capability.presets = function presetsBuilder(
    overrides: PresetOverrides<string, Record<string, PresetDef>>
  ): ConfiguredCapability {
    const configured = Object.create(capability);
    configured.__presetOverrides = overrides;
    return configured;
  };

  return capability;
}
