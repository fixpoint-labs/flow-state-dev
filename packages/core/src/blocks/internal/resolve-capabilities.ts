/**
 * Shared capability resolution logic for block factories.
 *
 * Flattens, merges, and resolves capabilities declared in a block's `uses`
 * field. Returns merged declared resources, the resolved capability list
 * for ctx.cap construction at runtime, and optionally the merged surface
 * (used by generators to merge context/tools from presets).
 */
import type { BlockKind, DeclaredResources } from "../../types/block";
import type { CapabilityRef, UsesEntry } from "../../capability/types";
import type { MergedCapabilitySurface, DynamicUsesResolver } from "../../capability/merge";
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
  uses?: readonly UsesEntry[];
}

export interface ResolveResult {
  declaredResources: DeclaredResources | undefined;
  resolvedCapabilities: CapabilityRef[];
  mergedSurface: MergedCapabilitySurface | undefined;
  /** Dynamic uses entries collected from the block's uses AND nested capabilities. */
  dynamicUses: DynamicUsesResolver[];
}

/**
 * Resolve capabilities from a block config's `uses` field.
 *
 * Static capability refs are resolved at build time — resources, schemas,
 * context, and tools are merged immediately.
 *
 * Dynamic entries (functions) — whether at the block level or nested inside
 * a capability's own `uses` — are collected for runtime resolution. They
 * contribute context and tools only; resources must be declared statically.
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
      dynamicUses: [],
    };
  }

  // Partition top-level entries into static refs and dynamic functions
  const topStaticRefs: CapabilityRef[] = [];
  const topDynamicFns: DynamicUsesResolver[] = [];
  for (const entry of config.uses) {
    if (typeof entry === "function") {
      topDynamicFns.push(entry);
    } else {
      topStaticRefs.push(entry);
    }
  }

  if (topStaticRefs.length === 0) {
    return {
      declaredResources: blockResources,
      resolvedCapabilities: [],
      mergedSurface: undefined,
      dynamicUses: topDynamicFns,
    };
  }

  // Flatten static refs — also collects dynamic entries from nested capabilities
  const { staticRefs: flattened, dynamicResolvers: nestedDynamic } =
    flattenCapabilities(topStaticRefs, { collectDynamic: true });

  const allDynamic = [...topDynamicFns, ...nestedDynamic];

  const merged = mergeCapabilities(flattened, blockKind);
  const capResources = extractMergedResources(merged);
  const declaredResources = mergeWithBlockResources(capResources, blockResources);

  return {
    declaredResources,
    resolvedCapabilities: flattened,
    mergedSurface: merged,
    dynamicUses: allDynamic,
  };
}
