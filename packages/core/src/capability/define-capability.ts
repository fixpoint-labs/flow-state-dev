/**
 * defineCapability() factory — creates a branded capability descriptor.
 *
 * Follows the defineResource() pattern: returns the config object branded
 * with phantom types for downstream type inference. The same reference is
 * reused across blocks, enabling diamond-dependency deduplication via ===.
 */
import type {
  CapabilityConfig,
  ConfiguredCapability,
  DefinedCapability,
  PresetDef,
  PresetOverrides,
} from "./types";

export function defineCapability<
  const TName extends string,
  const TFns extends Record<string, (...args: any[]) => any> = Record<string, never>,
  const TPresets extends Record<string, PresetDef | string[]> = Record<string, never>,
  const TUses extends readonly DefinedCapability[] = readonly DefinedCapability[],
>(
  config: CapabilityConfig<TName, TFns, TPresets, TUses>
): DefinedCapability<
  TName,
  TFns,
  TPresets extends Record<string, any>
    ? Exclude<keyof TPresets, "default"> & string
    : never,
  TPresets
> {
  if (!config.name || config.name.trim() === "") {
    throw new Error("defineCapability() requires a non-empty name");
  }

  // Build the runtime object: copy config fields, move presets to __presetDefs,
  // replace presets with the builder method.
  const capability: any = {
    __brand: "Capability" as const,
    name: config.name,
    sessionResources: config.sessionResources,
    userResources: config.userResources,
    projectResources: config.projectResources,
    sessionStateSchema: config.sessionStateSchema,
    requestStateSchema: config.requestStateSchema,
    userStateSchema: config.userStateSchema,
    projectStateSchema: config.projectStateSchema,
    sequencerStateSchema: config.sequencerStateSchema,
    targetStateSchemas: config.targetStateSchemas,
    uses: config.uses,
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
