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
import { buildBlock, extractDeclaredResources, mergeDeclaredResources } from "./internal/build-block";
import { isBlockDefinition } from "./internal/utils";

/**
 * Merge the router's own declared resources with resources from all route blocks.
 * This ensures resources declared deep in route pipelines bubble up through the
 * router to the flow level.
 */
function mergeRouterResources(config: { routes?: BlockDefinition<any, any>[]; sessionResources?: Record<string, DeclaredResourceEntry>; userResources?: Record<string, DeclaredResourceEntry>; projectResources?: Record<string, DeclaredResourceEntry> }) {
  let merged = extractDeclaredResources(config);
  if (config.routes) {
    for (const route of config.routes) {
      merged = mergeDeclaredResources(merged, route.declaredResources);
    }
  }
  return merged;
}

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
  // Resource definitions — optional, provide typing AND auto-installation
  TSessionResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TUserResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  // Derive-once: map resource schemas/definitions to typed ResourceRef records
  TSessionResources extends Record<string, AnyResourceRef> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, AnyResourceRef> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, AnyResourceRef> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
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
  routes: BlockDefinition<TInputSchema, TOutputSchema>[];
  execute: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TProjectState,
      TSessionResources, TUserResources, TProjectResources, TSequencerState, TTargetSchemas
    >
  ) => Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>;
  validateRoute?: (
    candidate: BlockDefinition<TInputSchema, TOutputSchema>,
    routes: BlockDefinition<TInputSchema, TOutputSchema>[],
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TProjectState,
      TSessionResources, TUserResources, TProjectResources, TSequencerState, TTargetSchemas
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
  TSessionResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TUserResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TProjectResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TSessionResources extends Record<string, AnyResourceRef> = InferBlockResources<TSessionResourceSchemas, TSessionResourceDefs>,
  TUserResources extends Record<string, AnyResourceRef> = InferBlockResources<TUserResourceSchemas, TUserResourceDefs>,
  TProjectResources extends Record<string, AnyResourceRef> = InferBlockResources<TProjectResourceSchemas, TProjectResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
>(
  config: RouterConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TProjectStateSchema, TSequencerStateSchema,
    TRequestState, TSessionState, TUserState, TProjectState, TSequencerState,
    TSessionResourceSchemas, TUserResourceSchemas, TProjectResourceSchemas,
    TSessionResourceDefs, TUserResourceDefs, TProjectResourceDefs,
    TSessionResources, TUserResources, TProjectResources, TTargetSchemas
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "router",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    declaredResources: mergeRouterResources(config),
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

      ctx._runtimeHooks?.onRouteSelected?.(config.name, selected.name, ctx._blockIdentity?.blockInstanceId);

      const startedAt = Date.now();
      const runSelected = async (scopedCtx: BlockContext): Promise<TOutput> => {
        scopedCtx._runtimeHooks?.onBlockStart?.(selected.name, selected.kind, input);
        try {
          const output = await selected.run(input, scopedCtx);
          scopedCtx._runtimeHooks?.onBlockComplete?.(selected.name, selected.kind, output, Date.now() - startedAt);
          return output;
        } catch (error) {
          scopedCtx._runtimeHooks?.onBlockError?.(selected.name, selected.kind, error, Date.now() - startedAt);
          throw error;
        }
      };

      if (ctx._withExecutionScope === undefined) {
        return runSelected(ctx);
      }

      const containerConfig =
        selected.kind === "sequencer" || selected.kind === "router"
          ? (selected.config as { container?: { component?: string; label?: string | ((input: unknown) => string); metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>); } }).container
          : undefined;

      return ctx._withExecutionScope(
        {
          name: selected.name,
          kind: selected.kind,
          instanceId: `${selected.name}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          container:
            containerConfig === undefined
              ? undefined
              : {
                  component: containerConfig.component,
                  label:
                    typeof containerConfig.label === "function"
                      ? containerConfig.label(input as any)
                      : containerConfig.label,
                  metadata:
                    typeof containerConfig.metadata === "function"
                      ? containerConfig.metadata(input as any)
                      : containerConfig.metadata
                }
        },
        runSelected
      );
    }
  });
}
