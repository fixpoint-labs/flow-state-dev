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
  InferCapabilityOwnState,
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
  mergeCapabilityOwnStateWithBlock,
  extractMergedResources,
  mergeSurfaceInto,
  resolveActivePresets,
} from "./merge";
export type { MergedCapabilitySurface, DynamicUsesResolver, FlattenResult } from "./merge";
