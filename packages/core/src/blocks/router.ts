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
          scopedCtx._runtimeHooks?.onBlockError?.(selected.name, selected.kind, error, Date.now() - startedAt, selected.transient);
          throw error;
        }
      };

      // Router output is always pass-through from the selected route (FIX-413).
      // After the selected block emits its block_trace, record a `ref`
      // descriptor on the outer ctx so the router's own block_trace.output carries
      // the ref instead of duplicating content. Set AFTER runSelected below.
      const installRouterHint = (selectedInstanceId: string): void => {
        if (ctx.response === undefined) return;
        // Defensive: some legacy test fixtures use partial `ctx.response`
        // mocks without `getItems`. No-op falls back to inline (no ref hint).
        if (typeof ctx.response.getItems !== "function") return;
        const items = ctx.response.getItems();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i] as { id: string; type: string; provenance?: { blockInstanceId?: string } };
          if (item.type === "block_trace" && item.provenance?.blockInstanceId === selectedInstanceId) {
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

      // After the selected block has emitted its block_trace, record the
      // router's own ref descriptor so its outer emitter carries a ref, not
      // a duplicate of the selected block's content (FIX-413).
      installRouterHint(selectedInstanceId);
      return out;
    }
  });
}

/**
 * Config for `router.byName` — the by-name dispatch shorthand. Picks one
 * of `blocks[select(input, ctx)]`. The keys of `blocks` are the route
 * identifiers used by `select`.
 *
 * Input/output adaptation is intentionally NOT part of this primitive
 * per BP-013: pre-connect adapters on the routed blocks themselves
 * (`block.connectInput(...)`), or wrap the whole router. Keep this
 * surface tight.
 */
export interface RouterByNameConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
> {
  name: string;
  blocks: Record<string, BlockDefinition<any, any>>;
  select: (input: TInput, ctx: BlockContext) => string;
  /**
   * Optional block to run when `select` returns a key absent from
   * `blocks`. Without a fallback, an unknown key throws with the list
   * of registered keys for fast debugging.
   */
  fallback?: BlockDefinition<any, any>;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
}

/**
 * Build a router that selects one of `blocks[select(input, ctx)]`. The
 * generic primitive for "pick a block by string key from a Record" —
 * promoted from three hand-rolled implementations across the patterns
 * package (dispatchSpecialist, task-board worker registry, debate
 * speaker dispatch).
 *
 * Unknown keys throw with the registered key list. Provide `fallback`
 * to route unknowns to a default block instead.
 *
 * Input adaptation belongs on the routed blocks (`connectInput`), not
 * on this primitive (BP-013).
 */
function routerByName<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TOutputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
>(
  config: RouterByNameConfig<TInputSchema, TOutputSchema, TInput>,
): BlockDefinition<TInputSchema, TOutputSchema> {
  const { name, blocks, select, fallback, inputSchema, outputSchema } = config;
  const registeredRoutes = Object.values(blocks);
  const routes =
    fallback !== undefined && !registeredRoutes.includes(fallback)
      ? [...registeredRoutes, fallback]
      : registeredRoutes;

  const routerConfig = {
    name,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    routes,
    execute: (input: TInput, ctx: BlockContext) => {
      const key = select(input, ctx);
      const selected = blocks[key];
      if (selected !== undefined) return selected;
      if (fallback !== undefined) return fallback;
      throw new Error(
        `[router.byName] no block registered under key "${key}" in router "${name}". ` +
          `Available: ${Object.keys(blocks).join(", ")}`,
      );
    },
  } as unknown as RouterConfig<TInputSchema, TOutputSchema, TInput>;

  return router(routerConfig) as BlockDefinition<TInputSchema, TOutputSchema>;
}

router.byName = routerByName;
