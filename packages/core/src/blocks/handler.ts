import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferBlockResources,
  InferStateFromSchema
} from "../types/block";
import type { DefinedResource, ResourceHandle } from "../types/resource";
import { buildBlock, extractDeclaredResources } from "./internal/build-block";

export interface HandlerConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TOutput = z.infer<TOutputSchema>,
  // State schemas — optional, default to undefined (no schema declared)
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TProjectStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  // Derive-once: evaluate z.infer exactly once per provided schema
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TProjectState extends object = InferStateFromSchema<TProjectStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  // Resource schemas — optional, default to undefined (no typed resources)
  TSessionResourceSchemas extends ZodTypeAny | undefined = undefined,
  TUserResourceSchemas extends ZodTypeAny | undefined = undefined,
  TProjectResourceSchemas extends ZodTypeAny | undefined = undefined,
  // Resource definitions — optional, provide typing AND auto-installation
  TSessionResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  TUserResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  // Derive-once: map resource schemas/definitions to typed ResourceHandle records
  TSessionResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  projectStateSchema?: TProjectStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  sessionResourceSchemas?: TSessionResourceSchemas;
  userResourceSchemas?: TUserResourceSchemas;
  projectResourceSchemas?: TProjectResourceSchemas;
  sessionResources?: TSessionResourceDefs;
  userResources?: TUserResourceDefs;
  projectResources?: TProjectResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  execute: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TProjectState,
      TSessionResources, TUserResources, TProjectResources, TSequencerState, TTargetSchemas
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
  TProjectStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TProjectState extends object = InferStateFromSchema<TProjectStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  TSessionResourceSchemas extends ZodTypeAny | undefined = undefined,
  TUserResourceSchemas extends ZodTypeAny | undefined = undefined,
  TProjectResourceSchemas extends ZodTypeAny | undefined = undefined,
  TSessionResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  TUserResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DefinedResource> | undefined = undefined,
  TSessionResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, ResourceHandle<any>> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
>(
  config: HandlerConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TProjectStateSchema, TSequencerStateSchema,
    TRequestState, TSessionState, TUserState, TProjectState, TSequencerState,
    TSessionResourceSchemas, TUserResourceSchemas, TProjectResourceSchemas,
    TSessionResourceDefs, TUserResourceDefs, TProjectResourceDefs,
    TSessionResources, TUserResources, TProjectResources, TTargetSchemas
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "handler",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    execute: config.execute as unknown as (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput,
    declaredResources: extractDeclaredResources(config)
  });
}
