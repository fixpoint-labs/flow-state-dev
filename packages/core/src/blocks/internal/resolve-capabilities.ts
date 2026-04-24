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
import type { AgentType } from "../../items/types";
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
  agentType?: AgentType;
}

/**
 * Test whether a capability should attach to a block with the given agentType.
 * Unscoped caps (no `agentType`) always match. Scoped caps must have the
 * block's effective agent type in their allowlist. A block with no agentType
 * is treated as `"primary"` (the safe default — blocks not tagged as workers
 * are assumed to be the main agent).
 *
 * Exported so runtime dynamic-capability resolvers in generator.ts can apply
 * the same rule to caps returned by dynamic `uses` functions.
 */
export function capabilityMatchesAgent(
  cap: CapabilityRef,
  blockAgentType: AgentType | undefined,
): boolean {
  if (cap.agentType === undefined) return true;
  const effective: AgentType = blockAgentType ?? "primary";
  const allowed = Array.isArray(cap.agentType) ? cap.agentType : [cap.agentType];
  return allowed.includes(effective);
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

  // Capability-level agentType filter: drop caps whose allowlist excludes
  // the consuming block's agentType. Each cap is filtered independently
  // against the block; filtering is not transitive through `uses` trees
  // (a capability that depends on a "primary"-only cap still flattens it,
  // but the nested ref is kept or dropped based on its own agentType and
  // the block's, not the parent's).
  const allDynamic = [...topDynamicFns, ...nestedDynamic];
  const scoped = flattened.filter((cap) => capabilityMatchesAgent(cap, config.agentType));

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
