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
import type { InferCapabilities, UsesEntry } from "../capability/types";
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
  // Derive-once: evaluate z.infer exactly once per provided schema
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  // Resource definitions — single flat map (FIX-435). Scope is intrinsic to
  // each resource via `defineResource({ scope })`.
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TResources extends Record<string, AnyResourceRef> = InferBlockResources<undefined, TResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  // Capability type inference
  TUses extends readonly UsesEntry[] = readonly [],
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
      TResources, TSequencerState, TParentInput, TTargetSchemas,
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
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TResources extends Record<string, AnyResourceRef> = InferBlockResources<undefined, TResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
>(
  config: HandlerConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
    TResourceDefs, TResources, TTargetSchemas,
    TUses, TCapabilities
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
