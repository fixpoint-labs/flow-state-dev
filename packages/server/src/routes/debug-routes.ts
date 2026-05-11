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
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { jsonResponse } from "./route-utils";

/**
 * Resolved debug-endpoint configuration, with env-fallback + defaults applied.
 * Threaded through to handlers via `DebugRouteContext`.
 */
export interface ResolvedDebugConfig {
  enabled: boolean;
  allowedOrigins: string[];
  allowAnonymousLocal: boolean;
  countLimit: number;
}

export interface DebugRouteContext {
  registry: FlowRegistry;
  stores: StoreRegistry;
  debug: ResolvedDebugConfig;
}

const DEFAULT_COUNT_LIMIT = 1000;

/**
 * Applies fail-closed defaults to debug-endpoint config. Explicit `false` on
 * `debugEndpointsEnabled` always wins; `undefined` falls back to the
 * `FSDEV_DEBUG_ENDPOINTS=1` env flag. Origin allowlist defaults to empty —
 * loopback hosts are always permitted by `assertDebugAllowed` regardless.
 */
export function resolveDebugConfig(opts: {
  debugEndpointsEnabled?: boolean;
  debugAllowedOrigins?: string[];
  debugAllowAnonymousLocal?: boolean;
  debugCountLimit?: number;
}): ResolvedDebugConfig {
  const explicit = opts.debugEndpointsEnabled;
  const enabled =
    explicit === undefined
      ? process.env.FSDEV_DEBUG_ENDPOINTS === "1"
      : explicit;
  return {
    enabled,
    allowedOrigins: opts.debugAllowedOrigins ?? [],
    allowAnonymousLocal: opts.debugAllowAnonymousLocal ?? true,
    countLimit: opts.debugCountLimit ?? DEFAULT_COUNT_LIMIT
  };
}

/**
 * Gate decision returned by `assertDebugAllowed`. A non-null `Response` is
 * a 403 to return immediately; `null` means the handler may proceed.
 */
export function assertDebugAllowed(
  request: Request,
  cfg: ResolvedDebugConfig
): Response | null {
  if (!cfg.enabled) {
    return jsonResponse(403, { error: "debug_endpoints_disabled" });
  }
  const origin = pickOrigin(request);
  if (origin === null) {
    return cfg.allowAnonymousLocal
      ? null
      : jsonResponse(403, {
          error: "debug_endpoints_origin_rejected",
          origin: null
        });
  }
  if (isLoopbackOrigin(origin) || matchesAllowlist(origin, cfg.allowedOrigins)) {
    return null;
  }
  return jsonResponse(403, {
    error: "debug_endpoints_origin_rejected",
    origin
  });
}

function pickOrigin(request: Request): string | null {
  const o = request.headers.get("origin");
  if (o !== null && o.length > 0 && o !== "null") return o;
  const ref = request.headers.get("referer");
  if (ref === null) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

function matchesAllowlist(origin: string, allowlist: string[]): boolean {
  for (const allowed of allowlist) {
    if (origin === allowed) return true;
    if (allowed.endsWith("*") && origin.startsWith(allowed.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

const NOT_IMPLEMENTED = jsonResponse(501, { error: "not_implemented" });

export async function handleDebugListResources(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_list_resources" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  return NOT_IMPLEMENTED;
}

export async function handleDebugListCollectionItems(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_list_collection_items" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  return NOT_IMPLEMENTED;
}

export async function handleDebugGetResourceContent(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "debug_get_resource_content" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  return NOT_IMPLEMENTED;
}

export async function handleDebugGetCollectionItemContent(
  request: Request,
  _route: Extract<
    ParsedFlowRoute,
    { kind: "debug_get_collection_item_content" }
  >,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  return NOT_IMPLEMENTED;
}
