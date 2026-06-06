/**
 * Session state projection route handler.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  mergeScopeReads,
  resolveOrgStorageKey,
  resolveUserStorageKey,
  resourceScopeIds
} from "../stores/scope-keys";
import {
  buildResourceSnapshot,
  computeClientData,
  createScopeResources,
  getBooleanFlag,
  getPositiveInteger,
  getString,
  jsonResponse,
  parseClientDataFilter,
  sortItems
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

const DEFAULT_STATE_ITEMS_LIMIT = 100;

type StateRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
};

export async function handleGetSessionState(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_session_state" }>,
  ctx: StateRouteContext
): Promise<Response> {
  const session = await ctx.stores.session.get(route.sessionId);
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  const flow = ctx.registry.get(session.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${session.flowKind}"`
    });
  }

  const url = new URL(request.url);
  const user = await ctx.stores.user.get(resolveUserStorageKey(session.userId, flow));
  const org =
    session.orgId === undefined
      ? undefined
      : await ctx.stores.org.get(
          resolveOrgStorageKey(session.orgId, flow)
        );
  const clientDataFilter = parseClientDataFilter(
    url.searchParams.get("clientData")
  );
  const includeItems = getBooleanFlag(
    url.searchParams.get("include_items")
  );
  // FIX-579: the previous undocumented DevTool escape hatches
  // (`include_internal_resources`, `include=internal_state`) were removed in
  // favor of the privileged `/debug/resources*` surface. `/state` is now
  // strictly client-shaped — the same view a production React app sees.
  const offset = getPositiveInteger(url.searchParams.get("offset")) ?? 0;
  const limit =
    getPositiveInteger(url.searchParams.get("limit")) ?? DEFAULT_STATE_ITEMS_LIMIT;
  const itemTypesParam = url.searchParams.get("item_types");
  const itemTypeFilter = itemTypesParam
    ? new Set(itemTypesParam.split(",").map((t) => t.trim()).filter(Boolean))
    : undefined;

  let aggregatedItems: OutputItem[] | undefined;
  let totalItems = 0;
  if (includeItems) {
    const requests = await ctx.stores.request.list({
      sessionId: session.id,
      withItems: true
    });
    aggregatedItems = [];
    for (const req of requests) {
      if (req.items !== undefined) {
        for (const item of req.items) {
          if (itemTypeFilter !== undefined && !itemTypeFilter.has(item.type)) {
            continue;
          }
          if (
            itemTypeFilter === undefined &&
            !resolveItemVisibility(item).client
          ) {
            continue;
          }
          aggregatedItems.push(item);
        }
      }
    }

    aggregatedItems = sortItems(aggregatedItems);
    totalItems = aggregatedItems.length;
    aggregatedItems = aggregatedItems.slice(offset, offset + limit);
  }
  // Resource content is canonical in ContentStore (FIX-347); resource state is
  // canonical in ResourceStateStore (FIX-689). Both are keyed per-resource,
  // separate from the scope record.
  //
  // FIX-735: user/org resources key per isolation bucket (bare id when shared,
  // `{id}:{flowKind}` when isolated), so read every declared bucket and merge.
  // The snapshot/clientData builders filter to declared configs, so other
  // flows' shared rows under the bare key never leak in. The reads are keyed
  // off the identity id, not the scope record — a shared resource at the bare
  // id stays visible even when this flow's (flow-flag) scope record sits at a
  // different key or doesn't exist yet.
  const isoFlow = {
    kind: flow.kind,
    isolateUserState: flow.isolateUserState ?? false,
    isolateOrgState: flow.isolateOrgState ?? false,
    resources: flow.resources as Record<string, { scope?: string; flowIsolation?: boolean }> | undefined
  };
  const userScopeIds = resourceScopeIds(session.userId, isoFlow, "user");
  const orgScopeIds =
    session.orgId !== undefined ? resourceScopeIds(session.orgId, isoFlow, "org") : [];

  const [sessionContent, userContent, orgContent] = await Promise.all([
    ctx.stores.content.getAll("session", session.id),
    mergeScopeReads(userScopeIds.map((id) => ctx.stores.content.getAll("user", id))),
    mergeScopeReads(orgScopeIds.map((id) => ctx.stores.content.getAll("org", id)))
  ]);
  const [sessionState, userState, orgState] = await Promise.all([
    ctx.stores.resourceState.getAll("session", session.id),
    mergeScopeReads(userScopeIds.map((id) => ctx.stores.resourceState.getAll("user", id))),
    mergeScopeReads(orgScopeIds.map((id) => ctx.stores.resourceState.getAll("org", id)))
  ]);

  // FIX-435: partition the flat flow.resources map back into per-scope
  // buckets so the existing per-scope storage helpers and snapshot builders
  // continue to work. Each entry's `scope` is intrinsic to its definition.
  const flatFlowResources = (flow.resources ?? {}) as Record<string, { scope?: string }>;
  const sessionConfigs: Record<string, unknown> = {};
  const userConfigs: Record<string, unknown> = {};
  const orgConfigs: Record<string, unknown> = {};
  for (const [accessor, def] of Object.entries(flatFlowResources)) {
    if (def.scope === "session") sessionConfigs[accessor] = def;
    else if (def.scope === "user") userConfigs[accessor] = def;
    else if (def.scope === "org") orgConfigs[accessor] = def;
  }

  const sessionResources = createScopeResources({
    scope: "session",
    configs: sessionConfigs,
    persisted: sessionState,
    persistedContent: sessionContent
  });
  const userResources = createScopeResources({
    scope: "user",
    configs: userConfigs,
    persisted: userState,
    persistedContent: userContent
  });
  const orgResources = createScopeResources({
    scope: "org",
    configs: orgConfigs,
    persisted: orgState,
    persistedContent: orgContent
  });

  const sessionClientData = await computeClientData({
    config: flow.session?.client,
    scope: "session",
    filter: clientDataFilter,
    state: (session.state ?? {}) as JsonObject,
    resources: sessionResources
  });
  const userClientData = await computeClientData({
    config: flow.user?.client,
    scope: "user",
    filter: clientDataFilter,
    state: (user?.state ?? {}) as JsonObject,
    resources: userResources
  });
  const orgClientData = await computeClientData({
    config: flow.org?.client,
    scope: "org",
    filter: clientDataFilter,
    state: (org?.state ?? {}) as JsonObject,
    resources: orgResources
  });

  // Resource snapshot — strictly client-shaped. Resources with no `client`
  // config no longer surface here; use /debug/resources* (gated) for full
  // server-side inspection.
  const [sessionResourceSnapshot, userResourceSnapshot, orgResourceSnapshot] = await Promise.all([
    buildResourceSnapshot({
      configs: sessionConfigs,
      persisted: sessionState,
      persistedContent: sessionContent,
    }),
    buildResourceSnapshot({
      configs: userConfigs,
      persisted: userState,
      persistedContent: userContent,
    }),
    buildResourceSnapshot({
      configs: orgConfigs,
      persisted: orgState,
      persistedContent: orgContent,
    }),
  ]);

  const hasResources =
    sessionResourceSnapshot !== undefined ||
    userResourceSnapshot !== undefined ||
    orgResourceSnapshot !== undefined;

  // FIX-579: dropped `internalState` field (was gated by `?include=internal_state`).
  // The DevTool no longer relies on raw scope state from this endpoint.
  return jsonResponse(200, {
    sessionId: session.id,
    flowKind: session.flowKind,
    clientData: {
      session:
        Object.keys(sessionClientData).length > 0
          ? sessionClientData
          : undefined,
      user:
        Object.keys(userClientData).length > 0
          ? userClientData
          : undefined,
      org:
        Object.keys(orgClientData).length > 0
          ? orgClientData
          : undefined
    },
    resources: hasResources
      ? {
          session: sessionResourceSnapshot,
          user: userResourceSnapshot,
          org: orgResourceSnapshot,
        }
      : undefined,
    items: includeItems
      ? aggregatedItems
      : undefined,
    pagination: includeItems
      ? {
          offset,
          limit,
          total: totalItems,
          hasMore: offset + limit < totalItems,
          nextOffset: Math.min(offset + limit, totalItems)
        }
      : undefined
  });
}
