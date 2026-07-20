export { defineCapability } from "./define-capability";
export type {
  CapabilityConfig,
  CapabilityConfigDef,
  CapabilityConfigResolveCtx,
  CapabilityPresetCtx,
  CapabilityRef,
  UsesEntry,
  UsesSlot,
  ConfiguredCapability,
  DefinedCapability,
  InferCapabilities,
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  InferCapabilityTargets,
  PresetContextEntry,
  PresetDef,
  PresetOverrideFn,
  PresetOverrides,
} from "./types";
export {
  flattenCapabilities,
  getBaseCapability,
  mergeCapabilities,
  mergeWithBlockResources,
  extractMergedResources,
  mergeSurfaceInto,
  resolveActivePresets,
} from "./merge";
export type { MergedCapabilitySurface, DynamicUsesResolver, FlattenResult } from "./merge";
