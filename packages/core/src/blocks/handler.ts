import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferBlockResources,
  InferStateFromSchema
} from "../types/block";
import type { AnyResourceRef } from "../types/resource";
import type { DeclaredResourceEntry } from "../types/block";
import type {
  InferCapabilities,
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  MergeTargetSchemas,
  Prettify,
  UsesEntry,
} from "../capability/types";

import { buildBlock, extractDeclaredResources } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";

export interface HandlerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  // State schemas — optional, default to undefined (no schema declared)
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TParentInputSchema extends ZodTypeAny | undefined = undefined,
  // Resource definitions — single flat map (FIX-435). Scope is intrinsic to
  // each resource via `defineResource({ scope })`.
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  // Capability type inference. Declared above the derived state/resource
  // params so their defaults can intersect capability contributions.
  TUses extends readonly UsesEntry[] = readonly [],
  // Derive-once: evaluate z.infer exactly once per provided schema, then
  // intersect with capability-declared shapes (block-own on the LEFT of `&`
  // so its property declaration wins on a valid-object collision).
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  // Merged target schema map handed to BlockContext (which runs its own
  // schema → handle conversion at `ctx.targets`).
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  orgStateSchema?: TOrgStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  parentInputSchema?: TParentInputSchema;
  /**
   * Flat resource declaration: accessor key → resource definition. Resources
   * are routed to the right storage layer via their intrinsic `scope`
   * (set on `defineResource`). Replaces the legacy
   * `sessionResources` / `userResources` / `orgResources` (FIX-435).
   */
  resources?: TResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  /** Capabilities to install. Merges resources, state schemas, targets,
   *  and any active preset surfaces into this block's config. */
  uses?: TUses;
  execute: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, TParentInput, TMergedTargetSchemas,
      TCapabilities
    >
  ) => Promise<TOutput> | TOutput;
}

export function handler<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TParentInputSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
>(
  config: HandlerConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
    TResourceDefs, TTargetSchemas, TUses,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
    TResources, TMergedTargetSchemas, TCapabilities
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  const { declaredResources, resolvedCapabilities } = resolveCapabilities(config, "handler");

  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "handler",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    execute: config.execute as unknown as (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput,
    declaredResources,
    resolvedCapabilities,
  });
}

/**
 * The subset of `HandlerConfig` fields that make sense to default — shared
 * scaffolding like state schemas, declared resources, the output schema, and
 * the capability list. `name`, `inputSchema`, `execute`, and `description`
 * are deliberately excluded: those vary per block.
 */
export type HandlerDefaults<
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TOutputSchema extends ZodTypeAny | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
> = {
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  orgStateSchema?: TOrgStateSchema;
  requestStateSchema?: TRequestStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  resources?: TResourceDefs;
  outputSchema?: TOutputSchema;
  uses?: TUses;
};

/**
 * Build a `handler()` constructor with shared config baked in. The returned
 * function takes the rest of the handler config; the defaults are merged in
 * before being passed to `handler()`. Defaults can be overridden per-call by
 * specifying the field again.
 *
 * Typical use: an app or package defines a set of handlers that all share
 * the same `sessionStateSchema` and `resources` — `withDefaults` lets each
 * handler omit those fields.
 *
 * @example
 *   const memoHandler = handler.withDefaults({
 *     sessionStateSchema,
 *     resources: { memos: memosCollection },
 *     outputSchema: z.void(),
 *   });
 *
 *   export const commitBullMemo = memoHandler({
 *     name: "commit-memo-p2-bull",
 *     inputSchema: bullThesisSchema,
 *     execute: async (thesis, ctx) => {
 *       // ctx.session.state is typed from sessionStateSchema
 *       // ctx.resources.memos is typed from resources
 *       await ctx.resources.memos.get("p2/bull").patchState({ ... });
 *     },
 *   });
 */
handler.withDefaults = function withDefaults<
  TDSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TDUserStateSchema extends ZodTypeAny | undefined = undefined,
  TDOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TDRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TDSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TDResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TDOutputSchema extends ZodTypeAny | undefined = undefined,
  TDUses extends readonly UsesEntry[] = readonly [],
>(
  defaults: HandlerDefaults<
    TDSessionStateSchema,
    TDUserStateSchema,
    TDOrgStateSchema,
    TDRequestStateSchema,
    TDSequencerStateSchema,
    TDResourceDefs,
    TDOutputSchema,
    TDUses
  >,
) {
  return function configuredHandler<
    TInputSchema extends ZodTypeAny = ZodTypeAny,
    TOutputSchema extends ZodTypeAny = TDOutputSchema extends ZodTypeAny
      ? TDOutputSchema
      : ZodTypeAny,
    TInput = z.infer<TInputSchema>,
    TOutput = z.infer<TOutputSchema>,
    TRequestStateSchema extends ZodTypeAny | undefined = TDRequestStateSchema,
    TSessionStateSchema extends ZodTypeAny | undefined = TDSessionStateSchema,
    TUserStateSchema extends ZodTypeAny | undefined = TDUserStateSchema,
    TOrgStateSchema extends ZodTypeAny | undefined = TDOrgStateSchema,
    TSequencerStateSchema extends ZodTypeAny | undefined = TDSequencerStateSchema,
    TParentInputSchema extends ZodTypeAny | undefined = undefined,
    TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = TDResourceDefs,
    TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
    TUses extends readonly UsesEntry[] = TDUses,
    TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
    TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
    TUserState extends object = InferStateFromSchema<TUserStateSchema>,
    TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
    TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
    TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
    TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
    TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
    TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  >(
    config: Omit<
      HandlerConfig<
        TInputSchema, TOutputSchema, TInput, TOutput,
        TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
        TResourceDefs, TTargetSchemas, TUses,
        TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
        TResources, TMergedTargetSchemas, TCapabilities
      >,
      keyof typeof defaults
    > & Partial<Pick<
      HandlerConfig<
        TInputSchema, TOutputSchema, TInput, TOutput,
        TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
        TResourceDefs, TTargetSchemas, TUses,
        TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
        TResources, TMergedTargetSchemas, TCapabilities
      >,
      keyof typeof defaults & keyof HandlerConfig
    >>,
  ): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
    // Spread defaults first so per-call config overrides. Cast through unknown
    // because the merged shape's static type can't be expressed without
    // re-deriving every generic — runtime semantics are a simple object spread.
    const merged = { ...defaults, ...config } as unknown as HandlerConfig<
      TInputSchema, TOutputSchema, TInput, TOutput,
      TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
      TResourceDefs, TTargetSchemas, TUses,
      TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
      TResources, TMergedTargetSchemas, TCapabilities
    >;
    return handler(merged);
  };
};
