export { defineCapability } from "./define-capability";
export type {
  CapabilityConfig,
  CapabilityRef,
  ConfiguredCapability,
  DefinedCapability,
  InferCapabilities,
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
export type { MergedCapabilitySurface } from "./merge";
