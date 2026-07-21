/**
 * Capability merge utilities.
 *
 * flattenCapabilities() — transitive resolution with cycle detection and diamond dedup.
 * resolveActivePresets() — determine which presets are active given overrides.
 * mergeCapabilitySurface() — merge a capability's required + preset surfaces into
 *   an accumulator that becomes the block's effective config.
 */
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { isZodObject, compareZodSchemasStructurally } from "../helpers/zod-introspect";
import { deepEqual } from "../helpers/deep-equal";
import type { BlockKind, DeclaredResourceEntry, DeclaredResources } from "../types/block";
import type {
  GeneratorTool,
  ResolvableCachingConfig,
  ResolvableModel,
  ResolvableProviderOptions,
} from "../blocks/generator";
import type { BlockContext } from "../types/block";
import type {
  CapabilityConfigDef,
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
 * Recover the base defineCapability() reference from a potentially configured
 * capability — one that had `.presets()` and/or `.config()` called on it. Both
 * builders produce a clone exactly one hop from the base, so a single
 * `Object.getPrototypeOf` recovers it. A ref is configured iff it carries an
 * own `__presetOverrides` or `__config`.
 */
export function getBaseCapability(ref: CapabilityRef): DefinedCapability {
  if ("__presetOverrides" in ref || "__config" in ref) {
    return Object.getPrototypeOf(ref) as DefinedCapability;
  }
  return ref as DefinedCapability;
}

/** Whether a ref carries an own `.config()` value (vs. being used bare). */
function hasConfig(ref: CapabilityRef): boolean {
  return "__config" in ref;
}

/**
 * Two diamond paths reaching the same base would silently bake one config
 * closure and drop the other. Unlike presets (first-wins), config carries
 * values, so paths that would resolve differently are a build-time error;
 * paths that resolve identically dedup.
 *
 * Compatibility is decided on the value each ref would feed its resolver, which
 * is what `resolveConfigSurface` computes:
 * - With a schema, that is `schema.parse(configured ? value : undefined)`. So a
 *   bare ref and `.config({})` on a `.default({})` schema dedup (both parse to
 *   the defaults), and an omitted defaulted field is not a conflict. If exactly
 *   one path parses (e.g. the schema rejects `undefined`, making the bare path
 *   invalid), they resolve differently → conflict.
 * - Schemaless, the resolver receives the raw value and a bare ref is a
 *   mandatory-config error, so bare-vs-configured is a conflict and two
 *   configured refs compare by raw value.
 */
function assertConfigCompatible(
  existing: CapabilityRef,
  incoming: CapabilityRef,
  base: DefinedCapability
): void {
  if (existing === incoming) return;
  const hasA = hasConfig(existing);
  const hasB = hasConfig(incoming);
  const schema = base.__configDef?.schema;

  if (schema) {
    const a = schema.safeParse(hasA ? existing.__config : undefined);
    const b = schema.safeParse(hasB ? incoming.__config : undefined);
    if (a.success && b.success) {
      if (deepEqual(a.data, b.data)) return;
    } else if (!a.success && !b.success) {
      // Both invalid — a shared parse error surfaces at resolution.
      return;
    }
    // else: exactly one parses → they resolve differently → conflict below.
  } else {
    if (!hasA && !hasB) return; // both bare — a shared mandatory-config error
    if (hasA === hasB && deepEqual(existing.__config, incoming.__config)) return;
    // bare vs configured, or two differing values → conflict below.
  }

  throw new Error(
    `Conflicting .config() for capability "${base.name}": the same capability is ` +
    `used more than once with different configuration. Pass identical config, ` +
    `or configure it in a single place.`
  );
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
      if (getBaseCapability(existing) === base) {
        assertConfigCompatible(existing, ref, base);
        return;
      }
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
  /** Own-state contribution, merged across capabilities (FIX-914 PR2). */
  stateSchema: ZodTypeAny | undefined;
  targetStateSchemas: Record<string, ZodTypeAny> | undefined;
  contextEntries: Array<PresetContextEntry>;
  toolEntries: Array<GeneratorTool[] | ((ctx: BlockContext) => GeneratorTool[] | Promise<GeneratorTool[]>)>;
  // Generator-only singletons. Last-wins among capabilities; block-level
  // setting wins over capability (handled in the generator block factory).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: ResolvableModel<any, any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerOptions: ResolvableProviderOptions<any, any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caching: ResolvableCachingConfig<any, any> | undefined;
};

export function createEmptyMergedSurface(): MergedCapabilitySurface {
  return {
    resources: undefined,
    sessionStateSchema: undefined,
    requestStateSchema: undefined,
    userStateSchema: undefined,
    orgStateSchema: undefined,
    sequencerStateSchema: undefined,
    stateSchema: undefined,
    targetStateSchemas: undefined,
    contextEntries: [],
    toolEntries: [],
    model: undefined,
    providerOptions: undefined,
    caching: undefined,
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
  sourceLabel: string
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
      `Resource conflict in capability "${capName}" (${sourceLabel}): ` +
      `accessor "${name}" is declared with different defineResource() references`
    );
  }
  return merged;
}

/**
 * Merge Zod state schemas using z.object().extend() semantics.
 * Both schemas must be ZodObject instances for extend to work.
 *
 * NOTE: this silently last-wins on a duplicate field — the right policy for
 * session/request/user/org/sequencer scope schemas, where a later capability
 * refining a field is intended. Own-state (`stateSchema`) deliberately does
 * NOT route through here: it uses `collideOwnStateFields` instead, which
 * throws on an incompatible duplicate field (see FIX-914 PR2). Do not
 * "simplify" own-state by pointing it at `extendSchema` — the loud-collision
 * behavior is the point.
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

/**
 * Merge target state schemas. Same name + same reference → dedupe.
 * Same name + different reference → error.
 */
function mergeTargetsInto(
  target: Record<string, ZodTypeAny> | undefined,
  source: Record<string, ZodTypeAny>,
  capName: string,
  sourceLabel: string
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
      `Target conflict in capability "${capName}" (${sourceLabel}): ` +
      `"${name}" is declared with different schema references`
    );
  }
  return merged;
}

/**
 * Merge two own-state schemas field-by-field, throwing on the first
 * structurally-incompatible duplicate field instead of silently letting the
 * incoming side win (unlike `extendSchema`). A field declared by both sides
 * must be structurally compatible (see `compareZodSchemasStructurally`) —
 * this is the "collision detection" `sequencerStateSchema`'s `.extend()`
 * merge never had.
 */
function collideOwnStateFields(
  existing: ZodTypeAny,
  incoming: ZodTypeAny,
  describe: (key: string, reason: string) => string
): ZodTypeAny {
  if (!isZodObject(existing) || !isZodObject(incoming)) {
    throw new Error(describe("<root>", "both sides must be z.object() schemas to merge"));
  }
  const existingShape = (existing as ZodObject<ZodRawShape>).shape;
  const incomingShape = (incoming as ZodObject<ZodRawShape>).shape;
  for (const key of Object.keys(incomingShape)) {
    if (!(key in existingShape)) continue;
    const mismatch = compareZodSchemasStructurally(existingShape[key], incomingShape[key]);
    if (mismatch) {
      throw new Error(describe(key, mismatch.reason));
    }
  }
  return (existing as ZodObject<ZodRawShape>).extend(incomingShape);
}

/**
 * Merge own-state (`stateSchema`) contributions across capabilities in the
 * accumulator. Same-name fields from two capabilities must be structurally
 * compatible or this throws — see `collideOwnStateFields`.
 */
function mergeOwnStateSchema(
  target: ZodTypeAny | undefined,
  source: ZodTypeAny,
  capName: string,
  sourceLabel: string
): ZodTypeAny {
  if (target === undefined) return source;
  return collideOwnStateFields(target, source, (key, reason) =>
    `Own-state conflict in capability "${capName}" (${sourceLabel}): field "${key}" is ` +
    `already declared with an incompatible schema — ${reason}`
  );
}

/**
 * Merge the capability-contributed own-state schema (from `mergeCapabilities`)
 * with a block's own declared `stateSchema`. Same-name fields must be
 * structurally compatible or this throws — see `collideOwnStateFields`.
 * Mirrors `mergeWithBlockResources`'s capability-then-block shape.
 */
export function mergeCapabilityOwnStateWithBlock(
  capStateSchema: ZodTypeAny | undefined,
  blockStateSchema: ZodTypeAny | undefined,
  blockName: string
): ZodTypeAny | undefined {
  if (capStateSchema === undefined) return blockStateSchema;
  if (blockStateSchema === undefined) return capStateSchema;
  return collideOwnStateFields(capStateSchema, blockStateSchema, (key, reason) =>
    `Own-state conflict on block "${blockName}": field "${key}" is declared both directly ` +
    `and by a capability, with an incompatible schema — ${reason}`
  );
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
  presetName: string,
  sourceKind: "preset" | "config" = "preset"
): void {
  // How this surface is named in error messages: config surfaces report
  // "config" rather than a preset name (FIX-915); presets keep their name.
  const source = sourceKind === "config" ? "config" : `preset "${presetName}"`;

  // Resources — valid on all block kinds. Flat map; resource scope is
  // intrinsic via `defineResource({ scope })` (FIX-435).
  if (surface.resources) {
    acc.resources = mergeResourcesInto(
      acc.resources, surface.resources, capName, source
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
        `Capability "${capName}" ${source} declares sequencerStateSchema, ` +
        `but the consuming block is a ${blockKind}. sequencerStateSchema is only valid on sequencer blocks.`
      );
    }
    acc.sequencerStateSchema = extendSchema(acc.sequencerStateSchema, surface.sequencerStateSchema);
  }

  // Own state — valid on all block kinds (FIX-914 PR2: any block can hold
  // its own state, so any block's capability can contribute to it).
  if (surface.stateSchema) {
    acc.stateSchema = mergeOwnStateSchema(acc.stateSchema, surface.stateSchema, capName, source);
  }

  // Targets — valid on all block kinds
  if (surface.targetStateSchemas) {
    acc.targetStateSchemas = mergeTargetsInto(
      acc.targetStateSchemas, surface.targetStateSchemas, capName, source
    );
  }

  // Generator context — generator only
  if (surface.context !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" ${source} declares context, ` +
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
        `Capability "${capName}" ${source} declares tools, ` +
        `but the consuming block is a ${blockKind}. tools is only valid on generator blocks.`
      );
    }
    acc.toolEntries.push(surface.tools);
  }

  // Generator singletons — generator only. Last-wins among capabilities;
  // the generator block factory then prefers a block-level setting.
  if (surface.model !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" ${source} declares model, ` +
        `but the consuming block is a ${blockKind}. model is only valid on generator blocks.`
      );
    }
    acc.model = surface.model;
  }
  if (surface.providerOptions !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" ${source} declares providerOptions, ` +
        `but the consuming block is a ${blockKind}. providerOptions is only valid on generator blocks.`
      );
    }
    acc.providerOptions = surface.providerOptions;
  }
  if (surface.caching !== undefined) {
    if (blockKind !== "generator") {
      throw new Error(
        `Capability "${capName}" ${source} declares caching, ` +
        `but the consuming block is a ${blockKind}. caching is only valid on generator blocks.`
      );
    }
    acc.caching = surface.caching;
  }
}

// ---------------------------------------------------------------------------
// Resolve open config into a block surface
// ---------------------------------------------------------------------------

/**
 * Run a capability's config resolver (from `defineCapability({ config })`) into
 * a partial block surface, if it declares one. Returns undefined for a
 * capability with no config declaration.
 *
 * The config value is `schema.parse(rawConfig)` when a schema is declared, or
 * the raw `.config()` argument when schemaless. A capability meant to be usable
 * without `.config()` must declare a schema that accepts `undefined` at the top
 * level (e.g. `z.object({...}).default({})`); a schema that rejects `undefined`,
 * or a schemaless config, makes `.config()` mandatory and throws when omitted.
 * Resolver throws are wrapped with the capability name.
 */
export function resolveConfigSurface(
  cap: CapabilityRef,
  ctx: { presets: ReadonlySet<string>; blockKind: BlockKind }
): Partial<PresetDef> | undefined {
  const base = getBaseCapability(cap);
  const configDef = base.__configDef;
  if (!configDef) return undefined;

  const configured = hasConfig(cap);
  const rawConfig = configured ? cap.__config : undefined;

  let configValue: unknown;
  if (configDef.schema) {
    const parsed = configDef.schema.safeParse(rawConfig);
    if (!parsed.success) {
      if (!configured) {
        throw new Error(
          `Capability "${base.name}" requires configuration: call .config(...) ` +
          `on it (its config schema does not accept an absent value).`
        );
      }
      throw new Error(
        `Invalid config for capability "${base.name}": ${parsed.error.message}`
      );
    }
    configValue = parsed.data;
  } else {
    // Schemaless config — .config() is mandatory (there is no default to fall
    // back to), so an absent value is a build-time error rather than passing
    // raw undefined to a resolver typed as receiving a value.
    if (!configured) {
      throw new Error(
        `Capability "${base.name}" declares schemaless config and must be used ` +
        `with .config(...).`
      );
    }
    configValue = rawConfig;
  }

  try {
    return configDef.resolve(configValue, {
      presets: ctx.presets,
      blockKind: ctx.blockKind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Config resolver for capability "${base.name}" threw: ${message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Merge all capabilities into a surface accumulator
// ---------------------------------------------------------------------------

/**
 * Merge all flattened capabilities (required + active presets + open config)
 * into a MergedCapabilitySurface. The caller is responsible for flattening
 * first.
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

    // 3. Merge the open-config surface (after presets, so an explicit config
    //    value can win over this capability's own preset defaults; the resolver
    //    sees which presets are active and owns override-vs-add semantics).
    const configSurface = resolveConfigSurface(cap, {
      presets: new Set(activePresets.map((p) => p.name)),
      blockKind,
    });
    if (configSurface) {
      mergeSurfaceInto(acc, configSurface, blockKind, base.name, "<config>", "config");
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
