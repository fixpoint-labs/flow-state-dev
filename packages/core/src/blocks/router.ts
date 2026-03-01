import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  InferResourcesFromSchemas,
  InferStateFromSchema
} from "../types/block";
import type { ResourceHandle } from "../types/resource";
import { buildBlock } from "./internal/build-block";
import { isBlockDefinition } from "./internal/utils";

function isRouteInCandidates<TInputSchema extends ZodTypeAny, TOutputSchema extends ZodTypeAny>(
  candidate: BlockDefinition<TInputSchema, TOutputSchema>,
  routes: BlockDefinition<TInputSchema, TOutputSchema>[]
): boolean {
  return routes.some((route) => route === candidate || route.name === candidate.name);
}

export interface RouterConfig<
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
  // Derive-once: map resource schemas to typed ResourceHandle records
  TSessionResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TSessionResourceSchemas>,
  TUserResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TUserResourceSchemas>,
  TProjectResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TProjectResourceSchemas>,
> extends Omit<BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>, "execute"> {
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  projectStateSchema?: TProjectStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  sessionResourceSchemas?: TSessionResourceSchemas;
  userResourceSchemas?: TUserResourceSchemas;
  projectResourceSchemas?: TProjectResourceSchemas;
  connectInput?: ConnectorFn<unknown, TInput>;
  routes: BlockDefinition<TInputSchema, TOutputSchema>[];
  execute: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TProjectState,
      TSessionResources, TUserResources, TProjectResources, TSequencerState
    >
  ) => Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>;
  validateRoute?: (
    candidate: BlockDefinition<TInputSchema, TOutputSchema>,
    routes: BlockDefinition<TInputSchema, TOutputSchema>[],
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TProjectState,
      TSessionResources, TUserResources, TProjectResources, TSequencerState
    >
  ) => Promise<boolean> | boolean;
  container?: {
    component?: string;
    label?: string | ((input: TInput) => string);
    metadata?: Record<string, unknown> | ((input: TInput) => Record<string, unknown>);
  };
}

export function router<
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
  TSessionResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TSessionResourceSchemas>,
  TUserResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TUserResourceSchemas>,
  TProjectResources extends Record<string, ResourceHandle<any>> = InferResourcesFromSchemas<TProjectResourceSchemas>,
>(
  config: RouterConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TProjectStateSchema, TSequencerStateSchema,
    TRequestState, TSessionState, TUserState, TProjectState, TSequencerState,
    TSessionResourceSchemas, TUserResourceSchemas, TProjectResourceSchemas,
    TSessionResources, TUserResources, TProjectResources
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "router",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    execute: async (input, ctx) => {
      const candidate = (config.execute as (input: TInput, ctx: BlockContext) =>
        Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>
      )(input, ctx);

      // Sequencer definitions expose a `.then()` DSL method and can be mistaken
      // for thenables. Detect concrete blocks before awaiting route selection.
      const selected = isBlockDefinition(candidate)
        ? (candidate as BlockDefinition<TInputSchema, TOutputSchema>)
        : await candidate;
      const passesValidation =
        config.validateRoute === undefined
          ? isRouteInCandidates(selected, config.routes)
          : await (config.validateRoute as (
              candidate: BlockDefinition<TInputSchema, TOutputSchema>,
              routes: BlockDefinition<TInputSchema, TOutputSchema>[],
              input: TInput,
              ctx: BlockContext
            ) => Promise<boolean> | boolean)(selected, config.routes, input, ctx);

      if (!passesValidation) {
        throw new Error(
          `Router "${config.name}" selected invalid route "${selected.name}". Route must be one of declared candidates.`
        );
      }

      ctx._runtimeHooks?.onRouteSelected?.(config.name, selected.name);

      const startedAt = Date.now();
      ctx._runtimeHooks?.onBlockStart?.(selected.name, selected.kind, input);
      try {
        const output = await selected.run(input, ctx);
        ctx._runtimeHooks?.onBlockComplete?.(selected.name, selected.kind, output, Date.now() - startedAt);
        return output;
      } catch (error) {
        ctx._runtimeHooks?.onBlockError?.(selected.name, selected.kind, error, Date.now() - startedAt);
        throw error;
      }
    }
  });
}
