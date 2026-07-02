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

import { buildBlock, extractDeclaredResources, mergeDeclaredResources } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";
import { findBlockTraceIdByInstance } from "./internal/find-block-trace";
import type { ReplayLog } from "./internal/replay-log";
import {
  blockPathBranch,
  buildBlockInstanceId,
  extendBlockPath,
  ROOT_BLOCK_PATH
} from "./internal/block-instance-id";
import { isBlockDefinition } from "./internal/utils";
import { executeBlock, stashInputHint } from "./sequencer";
import { RouteUnavailableError } from "../errors/route-unavailable-error";

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
  // Unique route names are required for EVERY router (FIX-814): the durable
  // `router_decision` records a bare route name, and resume validates the
  // re-selected route against it. Whether a branch can suspend is not
  // statically decidable (a gate can hide arbitrarily deep, or in a dynamic
  // generator tool), so the constraint is universal, not suspendability-scoped.
  {
    const seen = new Set<string>();
    // `routes` is required by the type but tolerated as absent at runtime
    // elsewhere in this builder (e.g. type-only/transient test fixtures).
    for (const route of config.routes ?? []) {
      if (seen.has(route.name)) {
        throw new Error(
          `Router "${config.name}" declares duplicate route name "${route.name}". ` +
          `Route names must be unique so the recorded router decision is unambiguous on resume.`
        );
      }
      seen.add(route.name);
    }
  }

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

      // Decision replay (FIX-814): on same-request continuation, `execute`
      // re-runs (it must be pure — see the suspendable-router contract in
      // docs/architecture/execution-and-errors.md) so any per-call wrapper it
      // returns (`route.connectInput(...)`) is preserved. The fresh selection
      // is VALIDATED against the durably recorded `router_decision`; a
      // mismatch — re-decision drift or a removed route — is fatal, never a
      // silent branch switch.
      const requestId = ctx.request.identity.id;
      const routerPath = ctx._blockIdentity?.blockPath ?? ROOT_BLOCK_PATH;
      const replayLog = (ctx as { _replayLog?: ReplayLog })._replayLog;
      const recordedDecision = replayLog?.recordedRouterDecision(`${requestId}:${routerPath}`);
      if (recordedDecision !== undefined && recordedDecision.selectedRoute !== selected.name) {
        throw new RouteUnavailableError({
          routerName: config.name,
          recordedRoute: recordedDecision.selectedRoute,
          reselectedRoute: selected.name,
          recordedRouteDeclared: config.routes.some(
            (route) => route.name === recordedDecision.selectedRoute
          )
        });
      }

      // Await the decision anchor's durability BEFORE dispatching the branch
      // (FIX-814): the hook's `router_decision` write was fire-and-forget,
      // so a suspension inside the branch could persist before its anchor,
      // orphaning the decision for the resume path.
      await ctx._runtimeHooks?.onRouteSelected?.(config.name, selected.name, ctx._blockIdentity?.blockInstanceId);

      // FIX-573 §5: the routed block's input source matches whatever the
      // router itself received. Stash the router's own `_blockInputHint`
      // (or fall back to inline-rawInput for the request entry point) so
      // `executeBlock` forwards it onto the scoped child ctx and its
      // `added`-phase trace stamps the right source.
      const routerInputHint =
        (ctx as { _blockInputHint?: import("../items/types").BlockValueInternal<unknown> })._blockInputHint
        ?? ({ kind: "inline" as const, value: input });

      const selectedPath = extendBlockPath(routerPath, blockPathBranch(selected.name));
      const selectedInstanceId = buildBlockInstanceId(requestId, selectedPath, 0);

      // Dispatch the selected child through the replay seam (FIX-814):
      // `executeBlock` owns the scoped-child lifecycle (execution scope,
      // lifecycle hooks, container config, block-level rescue) AND consults
      // `ctx._replayLog`, so on resume a branch that already completed injects
      // its recorded output instead of re-executing.
      stashInputHint(ctx, routerInputHint);
      const out = (await executeBlock(selected, input, ctx, selectedPath)) as TOutput;

      // Router output is always pass-through from the selected route (FIX-413).
      // After the selected block emits its block_trace, record a `ref`
      // descriptor on the outer ctx so the router's own block_trace.output
      // carries the ref instead of duplicating content. When the branch
      // completed via the replay short-circuit (which deliberately emits no
      // fresh trace), fall back to the prior run's recorded trace id so the
      // ref contract holds on resume too (FIX-814).
      const traceLookupInstanceId =
        ctx._withExecutionScope === undefined
          // Standalone path: the selected block ran under the outer scope's
          // identity. Route by name match (fallback).
          ? ctx._blockIdentity?.blockInstanceId ?? ""
          : selectedInstanceId;
      const traceId =
        findBlockTraceIdByInstance(ctx, traceLookupInstanceId)
        ?? replayLog?.recordedBlockTraceId(`${requestId}:${selectedPath}`);
      if (traceId !== undefined) {
        (ctx as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = {
          kind: "ref",
          sourceItemId: traceId
        };
      }
      return out;
    }
  });
}
