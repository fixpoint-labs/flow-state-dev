/**
 * Shared capability resolution logic for block factories.
 *
 * Flattens, merges, and resolves capabilities declared in a block's `uses`
 * field. Returns merged declared resources, the resolved capability list
 * for ctx.cap construction at runtime, and optionally the merged surface
 * (used by generators to merge context/tools from presets).
 */
import type { BlockKind, DeclaredResources } from "../../types/block";
import type { CapabilityRef } from "../../capability/types";
import type { MergedCapabilitySurface } from "../../capability/merge";
import {
  flattenCapabilities,
  mergeCapabilities,
  extractMergedResources,
  mergeWithBlockResources,
} from "../../capability/merge";
import { extractDeclaredResources } from "./build-block";

interface HasResources {
  sessionResources?: Record<string, any>;
  userResources?: Record<string, any>;
  projectResources?: Record<string, any>;
  uses?: readonly CapabilityRef[];
}

export interface ResolveResult {
  declaredResources: DeclaredResources | undefined;
  resolvedCapabilities: CapabilityRef[];
  mergedSurface: MergedCapabilitySurface | undefined;
}

/**
 * Resolve capabilities from a block config's `uses` field.
 * Merges capability resources with the block's own declared resources.
 * Returns the merged surface for generators that need to merge context/tools.
 */
export function resolveCapabilities(
  config: HasResources,
  blockKind: BlockKind
): ResolveResult {
  const blockResources = extractDeclaredResources(config);

  if (!config.uses || config.uses.length === 0) {
    return {
      declaredResources: blockResources,
      resolvedCapabilities: [],
      mergedSurface: undefined,
    };
  }

  const flattened = flattenCapabilities(config.uses);
  const merged = mergeCapabilities(flattened, blockKind);
  const capResources = extractMergedResources(merged);
  const declaredResources = mergeWithBlockResources(capResources, blockResources);

  return {
    declaredResources,
    resolvedCapabilities: flattened,
    mergedSurface: merged,
  };
}
