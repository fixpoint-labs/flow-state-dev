/**
 * Session state projection route handler.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  resolveOrgStorageKey,
  resolveUserStorageKey
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
  const latestRequest = (
    await ctx.stores.request.list({
      sessionId: session.id,
      limit: 1
    })
  )[0];
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
  const includeInternalResources = getBooleanFlag(
    url.searchParams.get("include_internal_resources")
  );
  const offset = getPositiveInteger(url.searchParams.get("offset")) ?? 0;
  const limit =
    getPositiveInteger(url.searchParams.get("limit")) ?? DEFAULT_STATE_ITEMS_LIMIT;
  const itemTypesParam = url.searchParams.get("item_types");
  const itemTypeFilter = itemTypesParam
    ? new Set(itemTypesParam.split(",").map((t) => t.trim()).filter(Boolean))
    : undefined;

  // Legacy-compat safety net: pre-FIX-506 records were persisted before trace
  // items carried `agentType: "trace"`, so `resolveItemVisibility` alone can't
  // identify them. The hardcoded set covers those records; new records take
  // the primary `resolveItemVisibility(item).client === false` path below.
  // TODO(FIX-506): remove once we're confident no legacy records remain.
  const TRACE_ITEM_TYPES = new Set([
    "block_output",
    "router_decision",
    "state_snapshot",
  ]);

  let aggregatedItems: OutputItem[] | undefined;
  let totalItems = 0;
  if (includeItems) {
    const requests = await ctx.stores.request.list({
      sessionId: session.id
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
            (resolveItemVisibility(item).client === false || TRACE_ITEM_TYPES.has(item.type))
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
  // Resource content is canonical in ContentStore (FIX-347).
  const [sessionContent, userContent, orgContent] = await Promise.all([
    ctx.stores.content.getAll("session", session.id),
    user !== undefined ? ctx.stores.content.getAll("user", user.id) : Promise.resolve({}),
    org !== undefined ? ctx.stores.content.getAll("org", org.id) : Promise.resolve({})
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
    configs: sessionConfigs,
    persisted: session.resources as Record<string, unknown> | undefined,
    persistedContent: sessionContent
  });
  const userResources = createScopeResources({
    configs: userConfigs,
    persisted: user?.resources as Record<string, unknown> | undefined,
    persistedContent: userContent
  });
  const orgResources = createScopeResources({
    configs: orgConfigs,
    persisted: org?.resources as Record<string, unknown> | undefined,
    persistedContent: orgContent
  });

  const sessionClientData = await computeClientData({
    definitions: flow.session?.clientData as Record<string, unknown> | undefined,
    scope: "session",
    filter: clientDataFilter,
    state: (session.state ?? {}) as JsonObject,
    resources: sessionResources
  });
  const userClientData = await computeClientData({
    definitions: flow.user?.clientData as Record<string, unknown> | undefined,
    scope: "user",
    filter: clientDataFilter,
    state: (user?.state ?? {}) as JsonObject,
    resources: userResources
  });
  const orgClientData = await computeClientData({
    definitions: flow.org?.clientData as Record<string, unknown> | undefined,
    scope: "org",
    filter: clientDataFilter,
    state: (org?.state ?? {}) as JsonObject,
    resources: orgResources
  });

  // Build resource snapshot: client-visible resources by default. When the
  // caller passes include_internal_resources=true (the DevTool does), also
  // include resources without a `client` config — they're flagged `internal`
  // and surface their raw state under `clientData`.
  const [sessionResourceSnapshot, userResourceSnapshot, orgResourceSnapshot] = await Promise.all([
    buildResourceSnapshot({
      configs: sessionConfigs,
      persisted: session.resources as Record<string, unknown> | undefined,
      persistedContent: sessionContent,
      includeInternal: includeInternalResources,
    }),
    buildResourceSnapshot({
      configs: userConfigs,
      persisted: user?.resources as Record<string, unknown> | undefined,
      persistedContent: userContent,
      includeInternal: includeInternalResources,
    }),
    buildResourceSnapshot({
      configs: orgConfigs,
      persisted: org?.resources as Record<string, unknown> | undefined,
      persistedContent: orgContent,
      includeInternal: includeInternalResources,
    }),
  ]);

  const hasResources =
    sessionResourceSnapshot !== undefined ||
    userResourceSnapshot !== undefined ||
    orgResourceSnapshot !== undefined;

  return jsonResponse(200, {
    sessionId: session.id,
    flowKind: session.flowKind,
    state: {
      request: latestRequest?.state,
      session: session.state,
      user: user?.state,
      org: org?.state
    },
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
