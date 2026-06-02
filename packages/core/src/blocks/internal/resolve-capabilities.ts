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
import type { ItemVisibility } from "../../items/types";
import { deepEqual } from "../../helpers/deep-equal";
import {
  flattenCapabilities,
  mergeCapabilities,
  extractMergedResources,
  mergeWithBlockResources,
} from "../../capability/merge";
import { extractDeclaredResources } from "./build-block";

const PRIMARY_VISIBILITY: ItemVisibility = { client: true, history: true };

interface HasResources {
  resources?: Record<string, any>;
  uses?: readonly UsesEntry[];
  itemVisibility?: ItemVisibility;
}

/**
 * Test whether a capability should attach to a block with the given itemVisibility.
 * Unscoped caps (no `itemVisibility`) always match. Scoped caps must have the
 * block's effective visibility in their allowlist. A block with no itemVisibility
 * is treated as `{ client: true, history: true }` (the safe default — blocks
 * not tagged as workers are assumed to be the main agent).
 *
 * Exported so runtime dynamic-capability resolvers in generator.ts can apply
 * the same rule to caps returned by dynamic `uses` functions.
 */
export function capabilityMatchesAgent(
  cap: CapabilityRef,
  blockItemVisibility: ItemVisibility | undefined,
): boolean {
  if (cap.itemVisibility === undefined) return true;
  const effective: ItemVisibility = blockItemVisibility ?? PRIMARY_VISIBILITY;
  const allowed = Array.isArray(cap.itemVisibility) ? cap.itemVisibility : [cap.itemVisibility];
  return allowed.some((v) => deepEqual(v, effective));
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

  // Capability-level itemVisibility filter: drop caps whose allowlist
  // excludes the consuming block's itemVisibility. Each cap is filtered
  // independently; filtering is not transitive through `uses` trees.
  const allDynamic = [...topDynamicFns, ...nestedDynamic];
  const scoped = flattened.filter((cap) => capabilityMatchesAgent(cap, config.itemVisibility));

  const merged = mergeCapabilities(scoped, blockKind);
  const capResources = extractMergedResources(merged);
  const declaredResources = mergeWithBlockResources(capResources, blockResources);

  return {
    declaredResources,
    resolvedCapabilities: scoped,
    mergedSurface: merged,
    dynamicUses: allDynamic,
  };
}
