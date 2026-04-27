/**
 * Capability merge utilities.
 *
 * flattenCapabilities() — transitive resolution with cycle detection and diamond dedup.
 * resolveActivePresets() — determine which presets are active given overrides.
 * mergeCapabilitySurface() — merge a capability's required + preset surfaces into
 *   an accumulator that becomes the block's effective config.
 */
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import type { BlockKind, DeclaredResourceEntry, DeclaredResources } from "../types/block";
import type { GeneratorTool } from "../blocks/generator";
import type { BlockContext } from "../types/block";
import type {
  CapabilityRef,
  ConfiguredCapability,
  DefinedCapability,
  PresetContextEntry,
  PresetDef,
} from "./types";

// ---------------------------------------------------------------------------
// Base capability recovery (for diamond-dependency dedup)
// ---------------------------------------------------------------------------

/**
 * Recover the base defineCapability() reference from a potentially
 * configured capability (one that had .presets() called on it).
 */
export function getBaseCapability(ref: CapabilityRef): DefinedCapability {
  if ("__presetOverrides" in ref) {
    return Object.getPrototypeOf(ref) as DefinedCapability;
  }
  return ref as DefinedCapability;
}

// ---------------------------------------------------------------------------
// Flatten capabilities (transitive, deduplicated, dependency-ordered)
// ---------------------------------------------------------------------------

/** Dynamic uses entry — a function that resolves capabilities at runtime. */
export type DynamicUsesResolver = (ctx: any) => readonly CapabilityRef[];

/** Result of flattening capabilities — static refs + collected dynamic resolvers. */
export interface FlattenResult {
  /** Deduplicated, dependency-ordered static capability refs. */
  staticRefs: CapabilityRef[];
  /** Dynamic uses entries collected from all traversed capabilities. */
  dynamicResolvers: DynamicUsesResolver[];
}

/**
 * Flatten a list of CapabilityRef entries into a deduplicated, transitively
 * resolved list. Detects cycles. Returns capabilities in dependency order
 * (dependencies before dependents).
 *
 * Dynamic entries (functions) encountered during traversal — either at the
 * top level or nested inside a capability's `uses` — are collected separately.
 * They contribute context and tools at runtime, not resources at build time.
 */
export function flattenCapabilities(
  refs: readonly CapabilityRef[]
): CapabilityRef[];
export function flattenCapabilities(
  refs: readonly CapabilityRef[],
  options: { collectDynamic: true }
): FlattenResult;
export function flattenCapabilities(
  refs: readonly CapabilityRef[],
  options?: { collectDynamic: boolean }
): CapabilityRef[] | FlattenResult {
  const seen = new Map<string, CapabilityRef>();
  const visiting = new Set<string>();
  const result: CapabilityRef[] = [];
  const dynamicResolvers: DynamicUsesResolver[] = [];

  function visit(ref: CapabilityRef): void {
    const base = getBaseCapability(ref);
    const name = base.name;

    if (visiting.has(name)) {
      throw new Error(
        `Capability cycle detected: "${name}" depends on itself (transitively)`
      );
    }

    if (seen.has(name)) {
      const existing = seen.get(name)!;
      // Same base capability reference → allowed (diamond dependency)
      if (getBaseCapability(existing) === base) return;
      // Different capability, same name → error
      throw new Error(
        `Capability name collision: "${name}" is declared by two different ` +
        `defineCapability() calls`
      );
    }

    visiting.add(name);

    // Visit transitive dependencies first (depth-first).
    // Dynamic uses (functions) are collected for runtime resolution.
    if (base.uses) {
      for (const dep of base.uses) {
        if (typeof dep === "function") {
          dynamicResolvers.push(dep);
        } else {
          visit(dep);
        }
      }
    }

    visiting.delete(name);
    seen.set(name, ref);
    result.push(ref);
  }

  for (const ref of refs) {
    visit(ref);
  }

  if (options?.collectDynamic) {
    return { staticRefs: result, dynamicResolvers };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolve active presets
// ---------------------------------------------------------------------------

/**
 * Resolve which presets are active for a capability, given any overrides
 * applied via .presets(). Returns the final list of preset definitions
 * (with function-form overrides applied) ready for surface merging.
 */
export function resolveActivePresets(
  cap: CapabilityRef
): Array<{ name: string; preset: PresetDef }> {
  const base = getBaseCapability(cap);
  const rawPresets = base.__presetDefs as (Record<string, any> & { default?: string[] }) | undefined;
  if (!rawPresets) return [];

  const overrides: Record<string, boolean | ((preset: PresetDef) => Partial<PresetDef>)> =
    "__presetOverrides" in cap
      ? ((cap as ConfiguredCapability).__presetOverrides as any) ?? {}
      : {};

  const presetEntries = Object.entries(rawPresets).filter(
    ([k]) => k !== "default"
  ) as [string, PresetDef][];

  // Validate that override keys reference real presets
  for (const overrideKey of Object.keys(overrides)) {
    if (!presetEntries.some(([k]) => k === overrideKey)) {
      throw new Error(
        `Unknown preset "${overrideKey}" on capability "${base.name}"`
      );
    }
  }

  const defaults: string[] =
    rawPresets.default ?? presetEntries.map(([k]) => k);

  const active: Array<{ name: string; preset: PresetDef }> = [];

  for (const [name, baseDef] of presetEntries) {
    const override = overrides[name];
    const isDefault = defaults.includes(name);
    const isActive =
      override === undefined
        ? isDefault
        : override === false
          ? false
          : true;

    if (!isActive) continue;

    let preset = baseDef;
    if (typeof override === "function") {
      const transformed = override(preset);
      preset = { ...preset, ...transformed };
    }

    active.push({ name, preset });
  }

  return active;
}

// ---------------------------------------------------------------------------
// Merged surface accumulator
// ---------------------------------------------------------------------------

/** Accumulator for merged capability surfaces. */
export type MergedCapabilitySurface = {
  resources: Record<string, DeclaredResourceEntry> | undefined;
  sessionStateSchema: ZodTypeAny | undefined;
  requestStateSchema: ZodTypeAny | undefined;
  userStateSchema: ZodTypeAny | undefined;
  orgStateSchema: ZodTypeAny | undefined;
  sequencerStateSchema: ZodTypeAny | undefined;
  targetStateSchemas: Record<string, ZodTypeAny> | undefined;
  contextEntries: Array<PresetContextEntry>;
  toolEntries: Array<GeneratorTool[] | ((ctx: BlockContext) => GeneratorTool[] | Promise<GeneratorTool[]>)>;
};

export function createEmptyMergedSurface(): MergedCapabilitySurface {
  return {
    resources: undefined,
    sessionStateSchema: undefined,
    requestStateSchema: undefined,
    userStateSchema: undefined,
    orgStateSchema: undefined,
    sequencerStateSchema: undefined,
    targetStateSchemas: undefined,
    contextEntries: [],
    toolEntries: [],
  };
}

// ---------------------------------------------------------------------------
// Surface merging
// ---------------------------------------------------------------------------

/**
 * Merge resource declarations from a surface into the accumulator.
 * Same reference → dedupe. Different reference, same accessor name → error.
 */
function mergeResourcesInto(
  target: Record<string, DeclaredResourceEntry> | undefined,
  source: Record<string, DeclaredResourceEntry>,
  capName: string,
  presetName: string
): Record<string, DeclaredResourceEntry> {
  const merged = target ? { ...target } : {};
  for (const [name, resource] of Object.entries(source)) {
    const existing = merged[name];
    if (existing === undefined) {
      merged[name] = resource;
      continue;
    }
    if (existing === resource) continue;
    throw new Error(
      `Resource conflict in capability "${capName}" (preset "${presetName}"): ` +
      `accessor "${name}" is declared with different defineResource() references`
    );
  }
  return merged;
}

/**
 * Merge Zod state schemas using z.object().extend() semantics.
 * Both schemas must be ZodObject instances for extend to work.
 */
function extendSchema(
  existing: ZodTypeAny | undefined,
  incoming: ZodTypeAny
): ZodTypeAny {
  if (existing === undefined) return incoming;
  // Use extend for ZodObject types (preserves .pick/.omit/.partial)
  if (isZodObject(existing) && isZodObject(incoming)) {
    return (existing as ZodObject<ZodRawShape>).extend(
      (incoming as ZodObject<ZodRawShape>).shape
    );
  }
  // If not both ZodObject, just return incoming (last-wins)
  return incoming;
}

function isZodObject(schema: ZodTypeAny): boolean {
  return schema._def?.typeName === "ZodObject";
}

/**
 * Merge target state schemas. Same name + same reference → dedupe.
 * Same name + different reference → error.
 */
function mergeTargetsInto(
  target: Record<string, ZodTypeAny> | undefined,
  source: Record<string, ZodTypeAny>,
  capName: string,
  presetName: string
): Record<string, ZodTypeAny> {
  const merged = target ? { ...target } : {};
  for (const [name, schema] of Object.entries(source)) {
    const existing = merged[name];
    if (existing === undefined) {
      merged[name] = schema;
      continue;
    }
    if (existing === schema) continue;
    throw new Error(
      `Target conflict in capability "${capName}" (preset "${presetName}"): ` +
      `"${name}" is declared with different schema references`
    );
  }
  return merged;
}

/**
 * Merge a single surface (required or preset) into the accumulator.
 * Validates block-kind compatibility and throws clear errors.
 */
export function mergeSurfaceInto(
  acc: MergedCapabilitySurface,
  surface: Partial<PresetDef>,
  blockKind: BlockKind,
  capName: string,
  presetName: string
): void {
  // Resources — valid on all block kinds. Flat map; resource scope is
  // intrinsic via `defineResource({ scope })` (FIX-435).
  if (surface.resources) {
    acc.resources = mergeResourcesInto(
      acc.resources, surface.resources, capName, presetName
    );
  }

  // Scope state schemas — valid on all block kinds
  if (surface.sessionStateSchema) {
    acc.sessionStateSchema = extendSchema(acc.sessionStateSchema, surface.sessionStateSchema);
  }
  if (surface.requestStateSchema) {
    acc.requestStateSchema = extendSchema(acc.requestStateSchema, surface.requestStateSchema);
  }
  if (surface.userStateSchema) {
    acc.userStateSchema = extendSchema(acc.userStateSchema, surface.userStateSchema);
  }
  if (surface.orgStateSchema) {
    acc.orgStateSchema = extendSchema(acc.orgStateSchema, surface.orgStateSchema);
  }

  // Sequencer state — sequencer only
  if (surface.sequencerStateSchema) {
    if (blockKind !== "sequencer") {
      throw new Error(
        `Capability "${capName}" preset "${presetName}" declares sequencerStateSchema, ` +
        `but the consuming block is a ${blockKind}. sequencerStateSchema is only valid on sequencer blocks.`
      );
    }
    acc.sequencerStateSchema = extendSchema(acc.sequencerStateSchema, surface.sequencerStateSchema);
  }

  // Targets — valid on all block kinds
  if (surface.targetStateSchemas) {
    acc.targetStateSchemas = mergeTargetsInto(
      acc.targetStateSchemas, surface.targetStateSchemas, capName, presetName
    );
  }

  // Generator context — generator only
  if (surface.context !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" preset "${presetName}" declares context, ` +
        `but the consuming block is a ${blockKind}. context is only valid on generator blocks.`
      );
    }
    const entries = Array.isArray(surface.context)
      ? surface.context
      : [surface.context];
    acc.contextEntries.push(...entries);
  }

  // Generator tools — generator only
  if (surface.tools !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" preset "${presetName}" declares tools, ` +
        `but the consuming block is a ${blockKind}. tools is only valid on generator blocks.`
      );
    }
    acc.toolEntries.push(surface.tools);
  }
}

// ---------------------------------------------------------------------------
// Merge all capabilities into a surface accumulator
// ---------------------------------------------------------------------------

/**
 * Merge all flattened capabilities (required + active presets) into
 * a MergedCapabilitySurface. The caller is responsible for flattening first.
 */
export function mergeCapabilities(
  caps: readonly CapabilityRef[],
  blockKind: BlockKind
): MergedCapabilitySurface {
  const acc = createEmptyMergedSurface();

  for (const cap of caps) {
    const base = getBaseCapability(cap);

    // 1. Merge required surface
    mergeSurfaceInto(acc, base, blockKind, base.name, "<required>");

    // 2. Merge active preset surfaces
    const activePresets = resolveActivePresets(cap);
    for (const { name: presetName, preset } of activePresets) {
      mergeSurfaceInto(acc, preset, blockKind, base.name, presetName);
    }
  }

  return acc;
}

// ---------------------------------------------------------------------------
// Org merged surface into block config fields
// ---------------------------------------------------------------------------

/**
 * Extract a DeclaredResources object from the merged surface,
 * suitable for passing to buildBlock().
 */
export function extractMergedResources(
  merged: MergedCapabilitySurface
): DeclaredResources | undefined {
  if (merged.resources === undefined || Object.keys(merged.resources).length === 0) {
    return undefined;
  }
  return { ...merged.resources };
}

/**
 * Merge the capability surface's resources with the block's own declared
 * resources. Block-level wins on dedup (same reference = ok).
 */
export function mergeWithBlockResources(
  capResources: DeclaredResources | undefined,
  blockResources: DeclaredResources | undefined
): DeclaredResources | undefined {
  if (capResources === undefined) return blockResources;
  if (blockResources === undefined) return capResources;

  const merged: DeclaredResources = { ...capResources };
  for (const [name, resource] of Object.entries(blockResources)) {
    const existing = merged[name];
    if (existing === undefined || existing === resource) {
      merged[name] = resource;
      continue;
    }
    throw new Error(
      `Resource conflict: accessor "${name}" is declared with different ` +
      `defineResource() references. Use the same reference across blocks.`
    );
  }
  return merged;
}
