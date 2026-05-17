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
import type {
  BlockContext,
  DeclaredResourceEntry,
  InferResourcesFromDefinitions,
  InferTargetStatesFromSchemas,
} from "../types/block";
import type {
  ContextObject,
  GeneratorTool,
  ResolvableCachingConfig,
  ResolvableModel,
  ResolvableProviderOptions,
} from "../blocks/generator";
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
 *
 * Resources live at `ctx.resources` (FIX-435); they're a flat namespace
 * routed by each resource's intrinsic `scope`.
 */
export type CapabilityPresetCtx<TSessionState = any> = {
  session: {
    state: Readonly<TSessionState>;
    identity: { id: string; userId?: string; orgId?: string };
    [key: string]: any;
  };
  resources: Record<string, any>;
  [key: string]: any;
};

/**
 * A preset definition — a partial block config. TSessionState flows from
 * the capability's sessionStateSchema so preset callbacks get typed ctx.
 */
export type PresetDef<TSessionState = any> = {
  // Resources (any block kind) — flat map; scope is intrinsic to each
  // resource via `defineResource({ scope })` (FIX-435).
  resources?: Record<string, DeclaredResourceEntry>;

  // State schemas (any block kind for the corresponding scope)
  sessionStateSchema?: ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  orgStateSchema?: ZodTypeAny;

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

  // Generator-only singletons. Block-kind validated at merge time — declaring
  // any of these on a capability used by a handler/sequencer/router throws a
  // clear error. Among capabilities, last-wins; among capability + block, the
  // block's own setting wins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: ResolvableModel<any, CapabilityPresetCtx<TSessionState>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerOptions?: ResolvableProviderOptions<any, CapabilityPresetCtx<TSessionState>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caching?: ResolvableCachingConfig<any, CapabilityPresetCtx<TSessionState>>;
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
  TResources extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
> {
  name: TName;

  // Required surface — always installed when the capability is used
  /** Flat resource map — accessor key → resource definition (FIX-435). */
  resources?: TResources extends Record<string, DeclaredResourceEntry>
    ? TResources
    : Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: TSessionStateSchema;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  orgStateSchema?: ZodTypeAny;
  sequencerStateSchema?: TSequencerStateSchema extends ZodTypeAny
    ? TSequencerStateSchema
    : ZodTypeAny;
  targetStateSchemas?: TTargetSchemas extends Record<string, ZodTypeAny>
    ? TTargetSchemas
    : Record<string, ZodTypeAny>;

  /**
   * Type-only escape hatch. When the inferred type from `sessionStateSchema`
   * is too loose (e.g. nested `z.record` or `z.any`), assert the exact ctx
   * shape consumers should see here. Carries no runtime value.
   *
   * Setting this without `sessionStateSchema` is a type error — schemas remain
   * the source of truth for runtime validation.
   */
  sessionStateType?: TSessionStateSchema extends ZodTypeAny ? unknown : never;
  /** Type-only escape hatch for resources. See `sessionStateType`. */
  resourcesType?: TResources extends Record<string, DeclaredResourceEntry> ? unknown : never;
  /** Type-only escape hatch for target state handles. See `sessionStateType`. */
  targetStatesType?: TTargetSchemas extends Record<string, ZodTypeAny> ? unknown : never;
  /** Type-only escape hatch for sequencer state. See `sessionStateType`. */
  sequencerStateType?: TSequencerStateSchema extends ZodTypeAny ? unknown : never;

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
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TResources extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
> {
  /** Brand — set by defineCapability() to identify capability objects. */
  readonly __brand: "Capability";

  readonly name: TName;

  // Required surface — always installed when the capability is used
  resources?: TResources extends Record<string, DeclaredResourceEntry>
    ? TResources
    : Record<string, DeclaredResourceEntry>;
  sessionStateSchema?: TSessionStateSchema extends ZodTypeAny
    ? TSessionStateSchema
    : ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  orgStateSchema?: ZodTypeAny;
  sequencerStateSchema?: TSequencerStateSchema extends ZodTypeAny
    ? TSequencerStateSchema
    : ZodTypeAny;
  targetStateSchemas?: TTargetSchemas extends Record<string, ZodTypeAny>
    ? TTargetSchemas
    : Record<string, ZodTypeAny>;

  /**
   * Type-only escape hatch carriers. These fields hold no runtime value;
   * `InferCapability*` utilities read them via `infer` to override the type
   * derived from the corresponding schema. Useful when the schema infers to
   * a shape that's too loose for consumer ctx (e.g. `z.record(z.any())`).
   */
  readonly sessionStateType?: unknown;
  readonly resourcesType?: unknown;
  readonly targetStatesType?: unknown;
  readonly sequencerStateType?: unknown;

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
  ): ConfiguredCapability<
    TName,
    TFns,
    TPresetNames,
    TPresets,
    TSessionStateSchema,
    TResources,
    TTargetSchemas,
    TSequencerStateSchema
  >;
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
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TResources extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
> extends DefinedCapability<
    TName,
    TFns,
    TPresetNames,
    TPresets,
    TSessionStateSchema,
    TResources,
    TTargetSchemas,
    TSequencerStateSchema
  > {
  readonly __presetOverrides: PresetOverrides<TPresetNames, TPresets>;
}

// ---------------------------------------------------------------------------
// Union type for `uses` arrays
// ---------------------------------------------------------------------------

/**
 * Accepted in block-level and capability-level `uses` arrays.
 */
export type CapabilityRef = DefinedCapability<any, any, any, any, any, any, any, any>;

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
  T extends DefinedCapability<infer N, infer F, any, any, any, any, any, any>
    ? { [K in N]: F }
    : never;

type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends
  (k: infer I) => void ? I : never;

/** Flatten an intersection type to a single object shape (display-only). */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infer the merged `ctx.session.state` shape contributed by static capabilities
 * in a `uses` array. Each capability contributes the `z.infer` of its
 * `sessionStateSchema`, unless its `sessionStateType` escape hatch is set, in
 * which case that exact type is used instead. Multi-capability arrays are
 * intersected. Empty arrays and arrays with no static refs resolve to `{}`.
 */
export type InferCapabilitySessionState<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilitySessionStateEntry<Extract<TUses[number], CapabilityRef>>>>;

type InferCapabilitySessionStateEntry<T> =
  T extends DefinedCapability<any, any, any, any, infer S, any, any, any>
    ? T extends { sessionStateType?: infer O }
      ? unknown extends O
        ? S extends ZodTypeAny ? import("zod").infer<S> : {}
        : NonNullable<O>
      : S extends ZodTypeAny ? import("zod").infer<S> : {}
    : {};

/**
 * Infer the merged `ctx.resources` shape contributed by static capabilities.
 * Each capability contributes its `resources` map mapped to ResourceRef /
 * ResourceCollectionRef handles, unless its `resourcesType` escape hatch is
 * set. Multi-capability arrays are intersected.
 */
export type InferCapabilityResources<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilityResourcesEntry<Extract<TUses[number], CapabilityRef>>>>;

type InferCapabilityResourcesEntry<T> =
  T extends DefinedCapability<any, any, any, any, any, infer R, any, any>
    ? T extends { resourcesType?: infer O }
      ? unknown extends O
        ? R extends Record<string, DeclaredResourceEntry> ? InferResourcesFromDefinitions<R> : {}
        : NonNullable<O>
      : R extends Record<string, DeclaredResourceEntry> ? InferResourcesFromDefinitions<R> : {}
    : {};

/**
 * Infer the merged `ctx.targets` shape contributed by static capabilities.
 * Each capability contributes typed StateRef handles for each declared target,
 * unless its `targetStatesType` escape hatch is set.
 */
export type InferCapabilityTargets<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilityTargetsEntry<Extract<TUses[number], CapabilityRef>>>>;

type InferCapabilityTargetsEntry<T> =
  T extends DefinedCapability<any, any, any, any, any, any, infer S, any>
    ? T extends { targetStatesType?: infer O }
      ? unknown extends O
        ? S extends Record<string, ZodTypeAny> ? InferTargetStatesFromSchemas<S> : {}
        : NonNullable<O>
      : S extends Record<string, ZodTypeAny> ? InferTargetStatesFromSchemas<S> : {}
    : {};

/**
 * Schema-level variant of {@link InferCapabilityTargets}. Returns the merged
 * `Record<string, ZodTypeAny>` of capability-declared target schemas (without
 * running them through `InferTargetStatesFromSchemas`). Block factories use
 * this to intersect with the block's own `TTargetSchemas` before handing the
 * merged schema map to `BlockContext`, which performs the handle conversion
 * itself at `ctx.targets`. Empty arrays and arrays with no static refs
 * resolve to `{}`.
 */
export type InferCapabilityTargetSchemas<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilityTargetSchemasEntry<Extract<TUses[number], CapabilityRef>>>>;

type InferCapabilityTargetSchemasEntry<T> =
  T extends DefinedCapability<any, any, any, any, any, any, infer S, any>
    ? S extends Record<string, ZodTypeAny> ? S : {}
    : {};

/**
 * Merge a block's own target schema map with any contributed by capabilities
 * in `uses`. Block-own wins on key collision because it sits on the LEFT of
 * the intersection (conflicting primitive types collapse to `never`, which is
 * the documented edge-case behavior). Returns `undefined` when neither side
 * contributes, so `ctx.targets` stays typed as `Record<string, never>` for
 * blocks that don't declare or inherit targets. Consumed by the handler,
 * generator, and router factories.
 */
export type MergeTargetSchemas<TOwn, TUses extends readonly UsesEntry[]> =
  TOwn extends Record<string, ZodTypeAny>
    ? Prettify<TOwn & InferCapabilityTargetSchemas<TUses>>
    : InferCapabilityTargetSchemas<TUses> extends infer C
      ? [keyof C] extends [never]
        ? undefined
        : Extract<C, Record<string, ZodTypeAny>>
      : undefined;

/**
 * Infer the merged sequencer state shape contributed by static capabilities.
 * Same shape as session state — `z.infer` of `sequencerStateSchema` per cap,
 * with `sequencerStateType` as an override.
 */
export type InferCapabilitySequencerState<TUses extends readonly UsesEntry[]> =
  [Extract<TUses[number], CapabilityRef>] extends [never]
    ? {}
    : Prettify<UnionToIntersection<InferCapabilitySequencerStateEntry<Extract<TUses[number], CapabilityRef>>>>;

type InferCapabilitySequencerStateEntry<T> =
  T extends DefinedCapability<any, any, any, any, any, any, any, infer S>
    ? T extends { sequencerStateType?: infer O }
      ? unknown extends O
        ? S extends ZodTypeAny ? import("zod").infer<S> : {}
        : NonNullable<O>
      : S extends ZodTypeAny ? import("zod").infer<S> : {}
    : {};
