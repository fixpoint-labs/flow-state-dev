/**
 * Debug route handlers — privileged, read-only inspection surface for the
 * full server-side resource layer of a session. Bypasses client-config
 * shaping (`client.data`, `client.state.read`, `client.content.read`,
 * `prefetchWindow`) so DevTool can show what production clients can't.
 *
 * Fail-closed: all handlers require `debugEndpointsEnabled` on the router
 * options (or `FSDEV_DEBUG_ENDPOINTS=1`) plus a loopback-origin gate.
 * Disabled by default; never exposed in production builds without explicit
 * opt-in by the deploying team.
 *
 * Phase 1 (this commit): route skeleton only. Handlers return 501 with a
 * placeholder body until subsequent steps land the gate, snapshot builder,
 * pagination, and content streaming.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { jsonResponse } from "./route-utils";

export interface DebugRouteContext {
  registry: FlowRegistry;
  stores: StoreRegistry;
}

const NOT_IMPLEMENTED = jsonResponse(501, { error: "not_implemented" });

export async function handleDebugListResources(
  _request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_list_resources" }>,
  _ctx: DebugRouteContext
): Promise<Response> {
  return NOT_IMPLEMENTED;
}

export async function handleDebugListCollectionItems(
  _request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_list_collection_items" }>,
  _ctx: DebugRouteContext
): Promise<Response> {
  return NOT_IMPLEMENTED;
}

export async function handleDebugGetResourceContent(
  _request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_get_resource_content" }>,
  _ctx: DebugRouteContext
): Promise<Response> {
  return NOT_IMPLEMENTED;
}

export async function handleDebugGetCollectionItemContent(
  _request: Request,
  _route: Extract<
    ParsedFlowRoute,
    { kind: "debug_get_collection_item_content" }
  >,
  _ctx: DebugRouteContext
): Promise<Response> {
  return NOT_IMPLEMENTED;
}
