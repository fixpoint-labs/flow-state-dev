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
import {
  buildDebugCollectionItems,
  buildDebugResourceTree,
  lookupDebugContent,
  type DebugContentResult
} from "./debug-snapshot";

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
  /** Tenant id from the request header (FIX-682); namespaces session lookups. */
  tenantId?: string;
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

/**
 * Read the `Origin` header. Browsers enforce it on cross-origin fetches and
 * clients can't lie about it from a real page; we therefore trust it.
 *
 * We deliberately do NOT fall back to the `Referer` header — `Referer` is
 * trivially spoofable from any non-browser client and would let a remote
 * caller bypass the origin gate by sending `Referer: http://localhost/`.
 * Headerless requests (e.g. curl) hit the `allowAnonymousLocal` knob below.
 */
function pickOrigin(request: Request): string | null {
  const o = request.headers.get("origin");
  if (o !== null && o.length > 0 && o !== "null") return o;
  return null;
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
    if (allowed.endsWith("*")) {
      // Bound the wildcard so `https://a.example*` doesn't match
      // `https://a.example.attacker.com`. Only exact match or a port
      // variant (prefix + `:`) is allowed.
      const prefix = allowed.slice(0, -1);
      if (origin === prefix || origin.startsWith(prefix + ":")) {
        return true;
      }
    }
  }
  return false;
}

export async function handleDebugListResources(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "debug_list_resources" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  const tree = await buildDebugResourceTree({
    sessionId: route.sessionId,
    ctx: { registry: ctx.registry, stores: ctx.stores },
    countLimit: ctx.debug.countLimit,
    tenantId: ctx.tenantId
  });
  if (tree === null) {
    return jsonResponse(404, { error: "session_not_found" });
  }
  return jsonResponse(200, tree);
}

export async function handleDebugListCollectionItems(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "debug_list_collection_items" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");
  const topic = url.searchParams.get("topic");
  const limit =
    limitParam === null ? null : Number.parseInt(limitParam, 10);
  if (limitParam !== null && !Number.isFinite(limit)) {
    return jsonResponse(400, {
      error: "bad_request",
      details: "limit must be a positive integer"
    });
  }
  const result = await buildDebugCollectionItems({
    sessionId: route.sessionId,
    ref: route.ref,
    limit: limit as number | null,
    cursor,
    topicFilter: topic,
    ctx: { registry: ctx.registry, stores: ctx.stores },
    tenantId: ctx.tenantId
  });
  if (result.ok) return jsonResponse(200, result.data);
  if (result.kind === "session_not_found") {
    return jsonResponse(404, { error: "session_not_found" });
  }
  if (result.kind === "resource_not_found") {
    return jsonResponse(404, { error: "resource_not_found", ref: route.ref });
  }
  if (result.kind === "not_collection") {
    return jsonResponse(400, {
      error: "bad_request",
      details: "ref is not a collection"
    });
  }
  return jsonResponse(400, {
    error: "bad_request",
    details: result.detail ?? "invalid_request"
  });
}

export async function handleDebugGetResourceContent(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "debug_get_resource_content" }>,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  const result = await lookupDebugContent({
    sessionId: route.sessionId,
    ref: route.ref,
    topic: null,
    ctx: { registry: ctx.registry, stores: ctx.stores },
    tenantId: ctx.tenantId
  });
  return contentResponse(result, route.ref, null);
}

export async function handleDebugGetCollectionItemContent(
  request: Request,
  route: Extract<
    ParsedFlowRoute,
    { kind: "debug_get_collection_item_content" }
  >,
  ctx: DebugRouteContext
): Promise<Response> {
  const denied = assertDebugAllowed(request, ctx.debug);
  if (denied !== null) return denied;
  const result = await lookupDebugContent({
    sessionId: route.sessionId,
    ref: route.ref,
    topic: route.topic,
    ctx: { registry: ctx.registry, stores: ctx.stores },
    tenantId: ctx.tenantId
  });
  return contentResponse(result, route.ref, route.topic);
}

/**
 * Translate a `lookupDebugContent` result into the wire response. Success
 * cases stream the body with its derived content-type; failures map to the
 * canonical 404 / 400 error codes per the spec's error taxonomy.
 */
function contentResponse(
  result: DebugContentResult,
  ref: string,
  topic: string | null
): Response {
  if (result.ok) {
    return new Response(result.body, {
      status: 200,
      headers: {
        "content-type": `${result.contentType}; charset=utf-8`
      }
    });
  }
  if (result.kind === "session_not_found") {
    return jsonResponse(404, { error: "session_not_found" });
  }
  if (result.kind === "resource_not_found") {
    return jsonResponse(404, { error: "resource_not_found", ref });
  }
  if (result.kind === "is_collection") {
    return jsonResponse(400, {
      error: "bad_request",
      details: "ref is a collection — request /items or a specific topic"
    });
  }
  if (result.kind === "not_collection") {
    return jsonResponse(400, {
      error: "bad_request",
      details: "ref is not a collection but a topic was provided"
    });
  }
  return jsonResponse(404, {
    error: "content_not_found",
    ref,
    topic: topic ?? undefined
  });
}
