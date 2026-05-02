import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockOutputHint,
  ConnectorFn,
  InferBlockResources,
  InferStateFromSchema
} from "../types/block";
import { asRuntime } from "../types/block";
import type { AnyResourceRef } from "../types/resource";
import type { DeclaredResourceEntry } from "../types/block";
import type { OutputItem } from "../items/types";
import type { InferCapabilities, UsesEntry } from "../capability/types";
import { buildBlock, extractDeclaredResources, mergeDeclaredResources } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";
import { resolveActiveStatusMessage } from "./internal/resolve-active-status-message";
import {
  blockPathBranch,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH
} from "./internal/block-instance-id";
import { isBlockDefinition } from "./internal/utils";

/**
 * Merge the router's own declared resources with resources from all route blocks.
 * This ensures resources declared deep in route pipelines bubble up through the
 * router to the flow level.
 */
function mergeRouterResources(config: { routes?: BlockDefinition<any, any>[]; resources?: Record<string, DeclaredResourceEntry> }) {
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
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  // Derive-once: evaluate z.infer exactly once per provided schema
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
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
  /** Flat resource declaration. See `HandlerConfig.resources` (FIX-435). */
  resources?: TResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  /** Capabilities to install. Merges resources, state schemas, targets,
   *  and any active preset surfaces into this block's config. */
  uses?: TUses;
  routes: BlockDefinition<TInputSchema, TOutputSchema>[];
  execute: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, unknown, TTargetSchemas,
      TCapabilities
    >
  ) => Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>;
  validateRoute?: (
    candidate: BlockDefinition<TInputSchema, TOutputSchema>,
    routes: BlockDefinition<TInputSchema, TOutputSchema>[],
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, unknown, TTargetSchemas,
      TCapabilities
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
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = InferStateFromSchema<TSessionStateSchema>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = InferStateFromSchema<TSequencerStateSchema>,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TResources extends Record<string, AnyResourceRef> = InferBlockResources<undefined, TResourceDefs>,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
>(
  config: RouterConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState,
    TResourceDefs, TResources, TTargetSchemas,
    TUses, TCapabilities
  >
): BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput> {
  const { declaredResources: capResources, resolvedCapabilities } = resolveCapabilities(config, "router");
  // Merge capability resources with the router's own + route resources.
  // capResources already includes the router's own declared resources (via resolveCapabilities).
  // mergeRouterResources also includes the router's own resources plus route resources.
  // The overlap is safe because mergeDeclaredResources deduplicates by reference equality.
  const routerResources = mergeRouterResources(config);
  const declaredResources = capResources
    ? mergeDeclaredResources(
        { ...capResources },
        routerResources
      )
    : routerResources;

  // Bubble `requireOrg` up from any route block. Without this, a route
  // declaring `requireOrg: true` would be silently lost — the router's
  // requiresOrg would stay `false`, and the flow's HTTP layer wouldn't
  // reject requests against unbound sessions as intended.
  const routesRequireOrg = config.routes !== undefined
    && config.routes.some((route) => route.requiresOrg);

  return buildBlock<TInputSchema, TOutputSchema, TInput, TOutput>({
    kind: "router",
    config: config as unknown as BlockConfig<TInputSchema, TOutputSchema, TInput, TOutput>,
    declaredResources,
    resolvedCapabilities,
    requiresOrg: routesRequireOrg,
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
        resolveActiveStatusMessage(selected, input, scopedCtx);
        try {
          const output = await asRuntime(selected).run(input, scopedCtx);
          scopedCtx._runtimeHooks?.onBlockComplete?.(selected.name, selected.kind, output, Date.now() - startedAt);
          return output;
        } catch (error) {
          scopedCtx._runtimeHooks?.onBlockError?.(selected.name, selected.kind, error, Date.now() - startedAt);
          throw error;
        }
      };

      // Router output is always pass-through from the selected route (FIX-413).
      // After the selected block emits its block_output, record a `ref`
      // descriptor on the outer ctx so the router's own block_output carries
      // the ref instead of duplicating content. Set AFTER runSelected below.
      const installRouterHint = (selectedInstanceId: string): void => {
        const response = ctx.response as unknown as { getItems?: () => OutputItem[] } | undefined;
        if (response === undefined || typeof response.getItems !== "function") return;
        const items = response.getItems();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (item.type === "block_output" && item.provenance?.blockInstanceId === selectedInstanceId) {
            (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = {
              kind: "ref",
              sourceItemId: item.id
            };
            return;
          }
        }
      };

      if (ctx._withExecutionScope === undefined) {
        const out = await runSelected(ctx);
        // Standalone path: selected block's blockInstanceId comes from the
        // outer scope's identity. Route by name match (fallback).
        installRouterHint(ctx._blockIdentity?.blockInstanceId ?? "");
        return out;
      }

      const containerConfig =
        selected.kind === "sequencer" || selected.kind === "router"
          ? (selected.config as { container?: { component?: string; label?: string | ((input: unknown) => string); metadata?: Record<string, unknown> | ((input: unknown) => Record<string, unknown>); } }).container
          : undefined;

      const parentPath = ctx._blockIdentity?.blockPath ?? ROOT_BLOCK_PATH;
      const selectedPath = extendBlockPath(parentPath, blockPathBranch(selected.name));
      const selectedInstanceId = buildBlockInstanceId(
        ctx.request.identity.id,
        selectedPath,
        0
      );

      const out = await ctx._withExecutionScope(
        {
          name: selected.name,
          kind: selected.kind,
          instanceId: selectedInstanceId,
          path: selectedPath,
          stateSchema: selected.kind === "sequencer" ? selected.config.stateSchema : undefined,
          input,
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

      // After the selected block has emitted its block_output, record the
      // router's own ref descriptor so its outer emitter carries a ref, not
      // a duplicate of the selected block's content (FIX-413).
      installRouterHint(selectedInstanceId);
      return out;
    }
  });
}
