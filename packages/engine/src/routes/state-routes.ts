/**
 * Session state projection route handler.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import { collapseToCanonicalLog, resolveItemVisibility } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import { resolveOrgStorageKey, resolveUserStorageKey } from "../stores/scope-keys";
import {
  resolveOwnerFlow,
  buildResourceSnapshot,
  computeClientData,
  createScopeResources,
  getBooleanFlag,
  getPositiveInteger,
  getString,
  jsonResponse,
  loadTenantSession,
  parseClientDataFilter,
  sortItems
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import {
  buildExternalResourceContextFromSession,
  getPersistedData
} from "../resources/internal";

const DEFAULT_STATE_ITEMS_LIMIT = 100;

type StateRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /** Tenant id from the request header (FIX-682); namespaces the session key. */
  tenantId?: string;
};

export async function handleGetSessionState(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_session_state" }>,
  ctx: StateRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }

  // The stored owner's declarations, never a kind-string lookup: two copies
  // of one definition may declare different schemas and providers.
  const owner = resolveOwnerFlow(ctx.registry, session);
  if (owner.denied !== undefined) return owner.denied;
  const flow = owner.flow;

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
      // Request records key on the BARE session id; isolate by the tenant
      // filter (FIX-682). `session.id` here is the namespaced storage key, so
      // it must not be used as the request filter.
      sessionId: route.sessionId,
      tenantId: ctx.tenantId,
      withItems: true
    });
    aggregatedItems = [];
    for (const req of requests) {
      if (req.items !== undefined) {
        // Collapse each request's physical log to its canonical view before
        // aggregating (FIX-811): a resumed request's suspending block re-emits
        // its pre-suspension items, and the superseded run-1 copies must not
        // surface in session history. Per-request because logical ids are
        // scoped by request id.
        for (const item of collapseToCanonicalLog(req.items)) {
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
  // One persisted-read function, shared with the resource routes and the debug
  // snapshot. `/state` used to walk the isolation buckets itself; two copies of
  // that walk is how the two `IsolationFlow` coercions drifted apart in the
  // first place, and the walk is where the FIX-1323 instance coordinate has to
  // be applied. `getPersistedData` owns all of it — the per-resource isolation
  // buckets (FIX-735), the lineage-shared session rows (FIX-1068), and the
  // tenant binding — for the owner instance resolved above.
  const persistCtx = { registry: ctx.registry, stores: ctx.stores };
  const [sessionPersisted, userPersisted, orgPersisted] = await Promise.all([
    getPersistedData(persistCtx, flow, route.sessionId, "session", ctx.tenantId),
    getPersistedData(persistCtx, flow, route.sessionId, "user", ctx.tenantId),
    getPersistedData(persistCtx, flow, route.sessionId, "org", ctx.tenantId)
  ]);
  // `undefined` is "this scope has no cell for this session" (org with no org
  // binding); the projection below treats that as an empty scope, as it did
  // when the walk produced an empty merge.
  const sessionContent = sessionPersisted?.content ?? {};
  const userContent = userPersisted?.content ?? {};
  const orgContent = orgPersisted?.content ?? {};
  const sessionState = sessionPersisted?.resources ?? {};
  const userState = userPersisted?.resources ?? {};
  const orgState = orgPersisted?.resources ?? {};

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
    persistedContent: sessionContent,
    externalContext: buildExternalResourceContextFromSession(session, "session", route.sessionId, request.signal)
  });
  const userResources = createScopeResources({
    scope: "user",
    configs: userConfigs,
    persisted: userState,
    persistedContent: userContent,
    externalContext: buildExternalResourceContextFromSession(session, "user", route.sessionId, request.signal)
  });
  const orgResources = createScopeResources({
    scope: "org",
    configs: orgConfigs,
    persisted: orgState,
    persistedContent: orgContent,
    externalContext: buildExternalResourceContextFromSession(session, "org", route.sessionId, request.signal)
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
    // Bare session id — `session.id` is the namespaced storage key (FIX-682).
    sessionId: route.sessionId,
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
