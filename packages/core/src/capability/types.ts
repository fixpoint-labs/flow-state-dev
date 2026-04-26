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
import type { ContextObject, GeneratorTool } from "../blocks/generator";
import type { AgentType } from "../items/types";

type MaybePromise<T> = T | Promise<T>;

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
/**
 * Lightweight context shape for preset callbacks. Inferred from the
 * capability's sessionStateSchema so `(ctx) =>` is typed automatically.
 * Defaults to `any` for backwards compatibility.
 */
export type CapabilityPresetCtx<TSessionState = any> = {
  session: {
    state: Readonly<TSessionState>;
    identity: { id: string; userId?: string; projectId?: string };
    resources: Record<string, any>;
    [key: string]: any;
  };
  [key: string]: any;
};

/**
 * A preset definition — a partial block config. TSessionState flows from
 * the capability's sessionStateSchema so preset callbacks get typed ctx.
 */
export type PresetDef<TSessionState = any> = {
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

  // Generator-specific — ctx type inferred from capability's sessionStateSchema
  context?:
    | PresetContextEntry<TSessionState>
    | PresetContextEntry<TSessionState>[];
  tools?:
    | GeneratorTool[]
    | ((ctx: CapabilityPresetCtx<TSessionState>) => GeneratorTool[] | Promise<GeneratorTool[]>);
};

/**
 * Context entry within a preset. Capabilities may contribute static strings,
 * static object-form context (keys become XML tag names — see `ContextObject`
 * in `@flow-state-dev/core`), or a function that receives `(input, ctx)` and
 * resolves to one of those shapes (or `null`/`undefined` to contribute nothing).
 */
export type PresetContextEntry<TSessionState = any> =
  | string
  | ContextObject<any, CapabilityPresetCtx<TSessionState>>
  | ((
      input: any,
      ctx: CapabilityPresetCtx<TSessionState>,
    ) => MaybePromise<
      | string
      | ContextObject<any, CapabilityPresetCtx<TSessionState>>
      | null
      | undefined
    >);

// ---------------------------------------------------------------------------
// Capability config (input to defineCapability)
// ---------------------------------------------------------------------------

/**
 * Configuration for defineCapability(). Declares the surface a capability
 * contributes to any block that lists it in `uses`.
 */
/** Infer state type from a ZodTypeAny, falling back to `any`. */
export type InferSessionState<T> = T extends ZodTypeAny ? import("zod").infer<T> : any;

export interface CapabilityConfig<
  TName extends string = string,
  TFns extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
> {
  name: TName;

  // Required surface — always installed when the capability is used
  sessionResources?: Record<string, DeclaredResourceEntry>;
  userResources?: Record<string, DeclaredResourceEntry>;
  projectResources?: Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: TSessionStateSchema;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  sequencerStateSchema?: ZodTypeAny;
  targetStateSchemas?: Record<string, ZodTypeAny>;

  // Capability composition — static refs and/or dynamic resolver functions.
  // Dynamic entries (functions) receive typed ctx from sessionStateSchema.
  uses?: readonly (
    | CapabilityRef
    | ((ctx: CapabilityPresetCtx<InferSessionState<TSessionStateSchema>>) => readonly CapabilityRef[])
  )[];

  /**
   * Restrict this capability to blocks with a matching `agentType`.
   *
   * Omitted (default): the capability attaches to every block that declares
   * it via `uses`. Set to an `AgentType` or array of `AgentType`s to filter
   * to an allowlist — the capability only attaches when the consuming
   * block's `agentType` is in the list. A block with no `agentType`
   * (including handlers, sequencers, routers, and generators that don't
   * set the field) is treated as `"primary"` for this check.
   *
   * Use `"primary"` on capabilities that should coordinate the main agent
   * but not be replicated into workers (`agentType: "sub"`), e.g. large
   * skill bodies or expensive system prompts in multi-agent patterns.
   */
  agentType?: AgentType | readonly AgentType[];

  // Helper function factory — produces ctx.cap.{name}
  fns?: (ctx: BlockContext) => TFns;

  // Optional surface — named bundles of block config fields.
  // `default` is a reserved key listing which presets are on by default.
  // Preset callbacks (tools, context) are typed via sessionStateSchema.
  presets?: Record<string, PresetDef<InferSessionState<TSessionStateSchema>> | string[]> & { default?: string[] };
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

  // Capability composition — static refs and/or dynamic resolver functions
  uses?: UsesSlot;

  /** Allowlist of block `agentType`s this capability attaches to. See CapabilityConfig.agentType. */
  agentType?: AgentType | readonly AgentType[];

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

/**
 * A single entry in a `uses` array — either a static capability reference
 * or a function that resolves capabilities at runtime based on context.
 *
 * Dynamic entries contribute context and tools only. Resources must be
 * declared statically (on the capability's required surface or elsewhere)
 * because they need to exist before block execution.
 */
export type UsesEntry = CapabilityRef | ((ctx: BlockContext) => readonly CapabilityRef[]);

/**
 * The `uses` slot on blocks and capabilities. Accepts a readonly array of
 * static capability refs and/or dynamic resolver functions.
 */
export type UsesSlot = readonly UsesEntry[];

// ---------------------------------------------------------------------------
// Type inference utilities
// ---------------------------------------------------------------------------

/**
 * Infer the ctx.cap type from a `uses` array.
 * Maps each capability's name → fns return type, then intersects.
 */
export type InferCapabilities<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilityEntry<Extract<TUses[number], CapabilityRef>>>> extends infer T
      ? T extends Record<string, Record<string, (...args: any[]) => any>>
        ? T
        : {}
      : {};

type InferCapabilityEntry<T> =
  T extends DefinedCapability<infer N, infer F, any, any>
    ? { [K in N]: F }
    : never;

type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends
  (k: infer I) => void ? I : never;

type Prettify<T> = { [K in keyof T]: T[K] } & {};
