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
import type {
  InferCapabilities,
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  MergeTargetSchemas,
  Prettify,
  UsesEntry,
} from "../capability/types";

import { buildBlock, extractDeclaredResources, mergeDeclaredResources } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";
import { resolveActiveStatusMessage } from "./internal/resolve-active-status-message";
import { findBlockTraceIdByInstance } from "./internal/find-block-trace";
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
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  // Capability type inference — declared above the derived state/resource
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
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
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
      TResources, TSequencerState, unknown, TMergedTargetSchemas,
      TCapabilities
    >
  ) => Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>;
  validateRoute?: (
    candidate: BlockDefinition<TInputSchema, TOutputSchema>,
    routes: BlockDefinition<TInputSchema, TOutputSchema>[],
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, unknown, TMergedTargetSchemas,
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
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
>(
  config: RouterConfig<
    TInputSchema, TOutputSchema, TInput, TOutput,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema,
    TResourceDefs, TTargetSchemas, TUses,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState,
    TResources, TMergedTargetSchemas, TCapabilities
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

  // The router's OWN declarations (FIX-688): its capability-injected resources
  // plus its own `resources` config, EXCLUDING the resources that bubble up
  // from route blocks. `capResources` already folds in the router's own
  // `resources` (via resolveCapabilities → extractDeclaredResources); merging
  // `extractDeclaredResources(config)` again is a reference-equal no-op that
  // also covers the no-capabilities case.
  const ownDeclaredResources = mergeDeclaredResources(
    capResources ? { ...capResources } : undefined,
    extractDeclaredResources(config)
  );

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
    ownDeclaredResources,
    resolvedCapabilities,
    requiresOrg: routesRequireOrg,
    execute: async (input, ctx) => {
      const candidate = (config.execute as (input: TInput, ctx: BlockContext) =>
        Promise<BlockDefinition<TInputSchema, TOutputSchema>> | BlockDefinition<TInputSchema, TOutputSchema>
      )(input, ctx);

      // A route selector may return a concrete block synchronously or a
      // promise of one. Detect the concrete block before awaiting so a
      // synchronously-returned block (e.g. a sequencer) is used as-is.
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
      // FIX-573 §5: the routed block's input source matches whatever the
      // router itself received. Forward the router's own `_blockInputHint`
      // (or fall back to inline-rawInput for the request entry point) onto
      // the scoped child ctx so its `added`-phase trace stamps the right
      // source.
      const routerInputHint =
        (ctx as { _blockInputHint?: import("../items/types").BlockValueInternal<unknown> })._blockInputHint
        ?? ({ kind: "inline" as const, value: input });
      const runSelected = async (scopedCtx: BlockContext): Promise<TOutput> => {
        (scopedCtx as { _blockInputHint?: import("../items/types").BlockValueInternal<unknown> })
          ._blockInputHint = routerInputHint;
        scopedCtx._runtimeHooks?.onBlockStart?.(selected.name, selected.kind, input, selected.transient);
        resolveActiveStatusMessage(selected, input, scopedCtx);
        try {
          const output = await asRuntime(selected).run(input, scopedCtx);
          scopedCtx._runtimeHooks?.onBlockComplete?.(selected.name, selected.kind, output, Date.now() - startedAt, selected.transient);
          return output;
        } catch (error) {
          scopedCtx._runtimeHooks?.onBlockError?.(selected.name, selected.kind, error, Date.now() - startedAt, selected.transient, scopedCtx);
          throw error;
        }
      };

      // Router output is always pass-through from the selected route (FIX-413).
      // After the selected block emits its block_trace, record a `ref`
      // descriptor on the outer ctx so the router's own block_trace.output carries
      // the ref instead of duplicating content. Set AFTER runSelected below.
      const installRouterHint = (selectedInstanceId: string): void => {
        const id = findBlockTraceIdByInstance(ctx, selectedInstanceId);
        if (id === undefined) return;
        (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = {
          kind: "ref",
          sourceItemId: id
        };
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

      // After the selected block has emitted its block_trace, record the
      // router's own ref descriptor so its outer emitter carries a ref, not
      // a duplicate of the selected block's content (FIX-413).
      installRouterHint(selectedInstanceId);
      return out;
    }
  });
}
