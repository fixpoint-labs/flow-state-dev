/**
 * Shared capability resolution logic for block factories.
 *
 * Flattens, merges, and resolves capabilities declared in a block's `uses`
 * field. Returns merged declared resources and the resolved capability list
 * for ctx.cap construction at runtime.
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

interface ResolveResult {
  declaredResources: DeclaredResources | undefined;
  resolvedCapabilities: CapabilityRef[];
}

interface ResolveResultWithSurface extends ResolveResult {
  mergedSurface: MergedCapabilitySurface | undefined;
}

/**
 * Resolve capabilities from a block config's `uses` field.
 * Merges capability resources with the block's own declared resources.
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
    };
  }

  const flattened = flattenCapabilities(config.uses);
  const merged = mergeCapabilities(flattened, blockKind);
  const capResources = extractMergedResources(merged);
  const declaredResources = mergeWithBlockResources(capResources, blockResources);

  return {
    declaredResources,
    resolvedCapabilities: flattened,
  };
}

/**
 * Generator-specific variant that also returns the merged surface,
 * so the generator factory can merge context entries and tools.
 */
export function resolveCapabilitiesForGenerator(
  config: HasResources
): ResolveResultWithSurface {
  const blockResources = extractDeclaredResources(config);

  if (!config.uses || config.uses.length === 0) {
    return {
      declaredResources: blockResources,
      resolvedCapabilities: [],
      mergedSurface: undefined,
    };
  }

  const flattened = flattenCapabilities(config.uses);
  const merged = mergeCapabilities(flattened, "generator");
  const capResources = extractMergedResources(merged);
  const declaredResources = mergeWithBlockResources(capResources, blockResources);

  return {
    declaredResources,
    resolvedCapabilities: flattened,
    mergedSurface: merged,
  };
}
