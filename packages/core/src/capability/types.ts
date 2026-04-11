/**
 * Capability type definitions for defineCapability().
 *
 * A capability is a packaging layer over existing declare-in-config primitives.
 * It bundles resource declarations, state schema fragments, target declarations,
 * helper function factories, and optional presets under a single name. Blocks
 * declare capabilities via `uses`, and the framework merges all declarations
 * transitively into the block's effective config.
 */
import type { ZodTypeAny } from "zod";
import type { BlockContext, DeclaredResourceEntry } from "../types/block";
import type { GeneratorTool } from "../blocks/generator";

// ---------------------------------------------------------------------------
// Preset definition
// ---------------------------------------------------------------------------

/**
 * A preset definition is a partial block config. Static fields (resources,
 * state schemas, targets) are declared directly. Dynamic fields (generator
 * context entries, generator tools) use the same shapes the corresponding
 * GeneratorConfig fields use.
 *
 * A preset can declare any field a block config supports. Block-kind
 * compatibility is enforced by the type system at the `uses` site and by
 * a runtime backstop in the block factories.
 */
export type PresetDef = {
  // Resources (any block kind)
  sessionResources?: Record<string, DeclaredResourceEntry>;
  userResources?: Record<string, DeclaredResourceEntry>;
  projectResources?: Record<string, DeclaredResourceEntry>;

  // State schemas (any block kind for the corresponding scope)
  sessionStateSchema?: ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;

  // Sequencer-only
  sequencerStateSchema?: ZodTypeAny;

  // Targets (any block kind)
  targetStateSchemas?: Record<string, ZodTypeAny>;

  // Generator-specific
  context?: GeneratorContextEntryAny | GeneratorContextEntryAny[];
  tools?:
    | GeneratorTool[]
    | ((ctx: BlockContext) => GeneratorTool[] | Promise<GeneratorTool[]>);
};

/**
 * Generator context entry type — matches the GeneratorSlotEntry function form.
 * We use a loose function signature here to avoid coupling the capability
 * types to the full GeneratorSlot type hierarchy.
 */
type GeneratorContextEntryAny = (input: any, ctx: any) => any;

// ---------------------------------------------------------------------------
// Capability config (input to defineCapability)
// ---------------------------------------------------------------------------

/**
 * Configuration for defineCapability(). Declares the surface a capability
 * contributes to any block that lists it in `uses`.
 */
export interface CapabilityConfig<
  TName extends string = string,
  TFns extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
  TPresets extends Record<string, PresetDef | string[]> = Record<string, PresetDef>,
  TUses extends readonly DefinedCapability[] = readonly DefinedCapability[],
> {
  name: TName;

  // Required surface — always installed when the capability is used
  sessionResources?: Record<string, DeclaredResourceEntry>;
  userResources?: Record<string, DeclaredResourceEntry>;
  projectResources?: Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  sequencerStateSchema?: ZodTypeAny;
  targetStateSchemas?: Record<string, ZodTypeAny>;

  // Capability composition
  uses?: TUses;

  // Helper function factory — produces ctx.cap.{name}
  fns?: (ctx: BlockContext) => TFns;

  // Optional surface — named bundles of block config fields.
  // `default` is a reserved key listing which presets are on by default.
  presets?: TPresets & { default?: string[] };
}

// ---------------------------------------------------------------------------
// Defined capability (output of defineCapability)
// ---------------------------------------------------------------------------

/**
 * The branded capability type returned by defineCapability().
 *
 * At runtime, the `presets` property from CapabilityConfig is replaced by
 * a builder method. The raw preset data is still accessible internally via
 * `__presetDefs`. DefinedCapability doesn't extend CapabilityConfig directly
 * because the `presets` property changes from data to a method.
 */
export interface DefinedCapability<
  TName extends string = string,
  TFns extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
  TPresetNames extends string = string,
  TPresets extends Record<string, PresetDef | string[]> = Record<string, PresetDef>,
> {
  /** Brand — set by defineCapability() to identify capability objects. */
  readonly __brand: "Capability";

  readonly name: TName;

  // Required surface — always installed when the capability is used
  sessionResources?: Record<string, DeclaredResourceEntry>;
  userResources?: Record<string, DeclaredResourceEntry>;
  projectResources?: Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  sequencerStateSchema?: ZodTypeAny;
  targetStateSchemas?: Record<string, ZodTypeAny>;

  // Capability composition
  uses?: readonly DefinedCapability[];

  // Helper function factory — produces ctx.cap.{name}
  fns?: (ctx: BlockContext) => TFns;

  /** Raw preset definitions. Set internally by defineCapability(). */
  readonly __presetDefs?: TPresets & { default?: string[] };

  /**
   * Configure which presets are active. Returns a new capability reference
   * with the overrides recorded (does not mutate the original).
   * Uses Object.create() to preserve base reference identity for diamond dedup.
   */
  presets(
    overrides: PresetOverrides<TPresetNames, TPresets>
  ): ConfiguredCapability<TName, TFns, TPresetNames, TPresets>;
}

// ---------------------------------------------------------------------------
// Preset overrides
// ---------------------------------------------------------------------------

export type PresetOverrides<
  TNames extends string,
  TPresets extends Record<string, PresetDef | string[]>,
> = {
  [K in TNames]?:
    | boolean
    | (K extends keyof TPresets
        ? TPresets[K] extends PresetDef
          ? PresetOverrideFn<TPresets[K]>
          : never
        : never);
};

/**
 * Function-form override receives the preset's declared object and returns
 * a possibly-modified version. Runs at block factory time.
 */
export type PresetOverrideFn<TPreset extends PresetDef> = (
  preset: TPreset
) => Partial<TPreset>;

// ---------------------------------------------------------------------------
// Configured capability (.presets() result)
// ---------------------------------------------------------------------------

export interface ConfiguredCapability<
  TName extends string = string,
  TFns extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
  TPresetNames extends string = string,
  TPresets extends Record<string, PresetDef | string[]> = Record<string, PresetDef>,
> extends DefinedCapability<TName, TFns, TPresetNames, TPresets> {
  readonly __presetOverrides: PresetOverrides<TPresetNames, TPresets>;
}

// ---------------------------------------------------------------------------
// Union type for `uses` arrays
// ---------------------------------------------------------------------------

/**
 * Accepted in block-level and capability-level `uses` arrays.
 */
export type CapabilityRef = DefinedCapability<any, any, any, any>;

// ---------------------------------------------------------------------------
// Type inference utilities
// ---------------------------------------------------------------------------

/**
 * Infer the ctx.cap type from a `uses` array.
 * Maps each capability's name → fns return type, then intersects.
 */
export type InferCapabilities<TUses extends readonly CapabilityRef[]> =
  TUses extends readonly []
    ? {}
    : Prettify<UnionToIntersection<InferCapabilityEntry<TUses[number]>>>;

type InferCapabilityEntry<T> =
  T extends DefinedCapability<infer N, infer F, any, any>
    ? { [K in N]: F }
    : never;

type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends
  (k: infer I) => void ? I : never;

type Prettify<T> = { [K in keyof T]: T[K] } & {};
