/**
 * Session state projection route handler.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
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
  const user = await ctx.stores.user.get(session.userId);
  const project =
    session.projectId === undefined
      ? undefined
      : await ctx.stores.project.get(session.projectId);
  const clientDataFilter = parseClientDataFilter(
    url.searchParams.get("clientData")
  );
  const includeItems = getBooleanFlag(
    url.searchParams.get("include_items")
  );
  const offset = getPositiveInteger(url.searchParams.get("offset")) ?? 0;
  const limit =
    getPositiveInteger(url.searchParams.get("limit")) ?? DEFAULT_STATE_ITEMS_LIMIT;
  const itemTypesParam = url.searchParams.get("item_types");
  const itemTypeFilter = itemTypesParam
    ? new Set(itemTypesParam.split(",").map((t) => t.trim()).filter(Boolean))
    : undefined;

  // FIX-391: type-based strip of known trace items on reload. The SSE
  // transport filters by `resolveItemVisibility(item).client`, but we can't
  // do the same here without also stripping container items from older
  // sessions (which were persisted with the now-fixed `client: false`).
  // Until the visibility model is redesigned, hardcode the known-trace type
  // list — these types have `client: false` defaults in ITEM_TYPE_DEFAULTS
  // and should never reach the UI as raw JSON.
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
          if (itemTypeFilter === undefined && TRACE_ITEM_TYPES.has(item.type)) {
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
  // Load content from ContentStore, merging with any inline record content
  // for backward compatibility with records created before ContentStore existed.
  const [sessionContentFromStore, userContentFromStore, projectContentFromStore] = await Promise.all([
    ctx.stores.content.getAll("session", session.id),
    user !== undefined ? ctx.stores.content.getAll("user", user.id) : Promise.resolve({}),
    project !== undefined ? ctx.stores.content.getAll("project", project.id) : Promise.resolve({})
  ]);

  const sessionResources = createScopeResources({
    configs: flow.session?.resources as Record<string, unknown> | undefined,
    persisted: session.resources as Record<string, unknown> | undefined,
    persistedContent: {
      ...(session.resourceContent as Record<string, string> | undefined),
      ...sessionContentFromStore
    }
  });
  const userResources = createScopeResources({
    configs: flow.user?.resources as Record<string, unknown> | undefined,
    persisted: user?.resources as Record<string, unknown> | undefined,
    persistedContent: {
      ...(user?.resourceContent as Record<string, string> | undefined),
      ...userContentFromStore
    }
  });
  const projectResources = createScopeResources({
    configs: flow.project?.resources as Record<string, unknown> | undefined,
    persisted: project?.resources as Record<string, unknown> | undefined,
    persistedContent: {
      ...(project?.resourceContent as Record<string, string> | undefined),
      ...projectContentFromStore
    }
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
  const projectClientData = await computeClientData({
    definitions: flow.project?.clientData as Record<string, unknown> | undefined,
    scope: "project",
    filter: clientDataFilter,
    state: (project?.state ?? {}) as JsonObject,
    resources: projectResources
  });

  // Build resource snapshot: includes only client-visible resources with clientData and optional prefetched content.
  // Use the merged content (record field + ContentStore) so prefetch works correctly.
  const [sessionResourceSnapshot, userResourceSnapshot, projectResourceSnapshot] = await Promise.all([
    buildResourceSnapshot({
      configs: flow.session?.resources as Record<string, unknown> | undefined,
      persisted: session.resources as Record<string, unknown> | undefined,
      persistedContent: {
        ...(session.resourceContent as Record<string, string> | undefined),
        ...sessionContentFromStore,
      },
    }),
    buildResourceSnapshot({
      configs: flow.user?.resources as Record<string, unknown> | undefined,
      persisted: user?.resources as Record<string, unknown> | undefined,
      persistedContent: {
        ...(user?.resourceContent as Record<string, string> | undefined),
        ...userContentFromStore,
      },
    }),
    buildResourceSnapshot({
      configs: flow.project?.resources as Record<string, unknown> | undefined,
      persisted: project?.resources as Record<string, unknown> | undefined,
      persistedContent: {
        ...(project?.resourceContent as Record<string, string> | undefined),
        ...projectContentFromStore,
      },
    }),
  ]);

  const hasResources =
    sessionResourceSnapshot !== undefined ||
    userResourceSnapshot !== undefined ||
    projectResourceSnapshot !== undefined;

  return jsonResponse(200, {
    sessionId: session.id,
    flowKind: session.flowKind,
    state: {
      request: latestRequest?.state,
      session: session.state,
      user: user?.state,
      project: project?.state
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
      project:
        Object.keys(projectClientData).length > 0
          ? projectClientData
          : undefined
    },
    resources: hasResources
      ? {
          session: sessionResourceSnapshot,
          user: userResourceSnapshot,
          project: projectResourceSnapshot,
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
