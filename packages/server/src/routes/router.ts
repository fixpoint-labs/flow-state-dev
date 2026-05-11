/**
 * Method-aware route table for `/api/flows`, plus a transport-pattern
 * compile helper for adapter-declared routes. Routes are grouped by
 * `ParsedFlowRoute` kind so omitting a kind is a TypeScript error at the
 * table declaration. Same-length method+path overlaps resolve through
 * `path-to-regexp`'s literal-segment specificity ranking.
 */
import { match, type MatchFunction } from "path-to-regexp";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type CoveredKind = Exclude<ParsedFlowRoute["kind"], "not_found">;

type Builder<K extends CoveredKind> = (
  params: Record<string, string>
) => Extract<ParsedFlowRoute, { kind: K }>;

interface RouteEntry<K extends CoveredKind = CoveredKind> {
  method: string;
  pattern: string;
  matcher: MatchFunction<Record<string, string | string[]>>;
  build: Builder<K>;
}

function entry<K extends CoveredKind>(
  method: string,
  pattern: string,
  build: Builder<K>
): RouteEntry<K> {
  return {
    method: method.toUpperCase(),
    pattern,
    matcher: match(pattern, { decode: decodeURIComponent }),
    build
  };
}

/**
 * Routes grouped by `ParsedFlowRoute` kind. The `Record<CoveredKind, ...>`
 * type forces every kind to have at least one entry — a missing kind is a
 * compile error here, not a silent 404. `execute_action` carries two
 * entries (session-bound and session-less variants) sharing one kind.
 */
const ROUTES_BY_KIND: { [K in CoveredKind]: RouteEntry<K>[] } = {
  list_flows: [entry("GET", "/", () => ({ kind: "list_flows" }))],
  capabilities: [entry("GET", "/capabilities", () => ({ kind: "capabilities" }))],
  list_sessions: [entry("GET", "/sessions", () => ({ kind: "list_sessions" }))],
  active_requests: [entry("GET", "/active-requests", () => ({ kind: "active_requests" }))],
  transcribe: [entry("POST", "/transcribe", () => ({ kind: "transcribe" }))],
  get_session: [
    entry("GET", "/sessions/:sessionId", (p) => ({
      kind: "get_session",
      sessionId: p.sessionId
    }))
  ],
  delete_session: [
    entry("DELETE", "/sessions/:sessionId", (p) => ({
      kind: "delete_session",
      sessionId: p.sessionId
    }))
  ],
  patch_session_metadata: [
    entry("PATCH", "/sessions/:sessionId/metadata", (p) => ({
      kind: "patch_session_metadata",
      sessionId: p.sessionId
    }))
  ],
  list_session_requests: [
    entry("GET", "/sessions/:sessionId/requests", (p) => ({
      kind: "list_session_requests",
      sessionId: p.sessionId
    }))
  ],
  get_session_state: [
    entry("GET", "/sessions/:sessionId/state", (p) => ({
      kind: "get_session_state",
      sessionId: p.sessionId
    }))
  ],
  user_stream: [
    entry("GET", "/users/:userId/stream", (p) => ({
      kind: "user_stream",
      userId: p.userId
    }))
  ],
  check_interrupted_requests: [
    entry("POST", "/users/:userId/check-interrupted", (p) => ({
      kind: "check_interrupted_requests",
      userId: p.userId
    }))
  ],
  create_session: [
    entry("POST", "/:flowKind/sessions", (p) => ({
      kind: "create_session",
      flowKind: p.flowKind
    }))
  ],
  execute_action: [
    entry("POST", "/:flowKind/actions/:actionName", (p) => ({
      kind: "execute_action",
      flowKind: p.flowKind,
      actionName: p.actionName
    })),
    entry("POST", "/:flowKind/:sessionId/actions/:actionName", (p) => ({
      kind: "execute_action",
      flowKind: p.flowKind,
      sessionId: p.sessionId,
      actionName: p.actionName
    }))
  ],
  request_stream: [
    entry("GET", "/:flowKind/requests/:requestId/stream", (p) => ({
      kind: "request_stream",
      flowKind: p.flowKind,
      requestId: p.requestId
    }))
  ],
  abort_request: [
    entry("POST", "/:flowKind/requests/:requestId/abort", (p) => ({
      kind: "abort_request",
      flowKind: p.flowKind,
      requestId: p.requestId
    }))
  ],
  request_status: [
    entry("GET", "/:flowKind/requests/:requestId/status", (p) => ({
      kind: "request_status",
      flowKind: p.flowKind,
      requestId: p.requestId
    }))
  ],
  retry_request: [
    entry(
      "POST",
      "/:flowKind/sessions/:sessionId/requests/:requestId/retry",
      (p) => ({
        kind: "retry_request",
        flowKind: p.flowKind,
        sessionId: p.sessionId,
        requestId: p.requestId
      })
    )
  ],
  get_resource_content: [
    entry("GET", "/sessions/:sessionId/resources/:ref/content", (p) => ({
      kind: "get_resource_content",
      sessionId: p.sessionId,
      ref: p.ref
    }))
  ],
  get_collection_item_content: [
    // `*topic` is a wildcard in path-to-regexp v8 — required because
    // collection topics commonly contain `/` (e.g. trading-desk's
    // `memos/**` pattern uses keys like `p1/fundamentals`). A `:topic`
    // single-segment param 404s on any slash-bearing topic.
    // `stringifyParams` joins the captured array on `/` before the build
    // callback runs, so `p.topic` remains a string.
    entry(
      "GET",
      "/sessions/:sessionId/resources/:ref/*topic/content",
      (p) => ({
        kind: "get_collection_item_content",
        sessionId: p.sessionId,
        ref: p.ref,
        topic: p.topic
      })
    )
  ],
  create_collection_item: [
    entry("POST", "/sessions/:sessionId/resources/:ref", (p) => ({
      kind: "create_collection_item",
      sessionId: p.sessionId,
      ref: p.ref
    }))
  ],
  update_resource_content: [
    entry(
      "PATCH",
      "/sessions/:sessionId/resources/:ref/*topic/content",
      (p) => ({
        kind: "update_resource_content",
        sessionId: p.sessionId,
        ref: p.ref,
        topic: p.topic
      })
    )
  ],
  delete_collection_item: [
    entry("DELETE", "/sessions/:sessionId/resources/:ref/*topic", (p) => ({
      kind: "delete_collection_item",
      sessionId: p.sessionId,
      ref: p.ref,
      topic: p.topic
    }))
  ],
  list_collection_state: [
    entry("GET", "/sessions/:sessionId/resources/:ref", (p) => ({
      kind: "list_collection_state",
      sessionId: p.sessionId,
      ref: p.ref
    }))
  ],
  get_collection_item_state: [
    entry("GET", "/sessions/:sessionId/resources/:ref/*topic", (p) => ({
      kind: "get_collection_item_state",
      sessionId: p.sessionId,
      ref: p.ref,
      topic: p.topic
    }))
  ],
  get_resource_manifest: [
    entry("GET", "/sessions/:sessionId/manifest", (p) => ({
      kind: "get_resource_manifest",
      sessionId: p.sessionId
    }))
  ]
};

const FLAT_ROUTES: RouteEntry[] = (
  Object.values(ROUTES_BY_KIND) as RouteEntry[][]
).flat();

/**
 * Resolves a method+path pair to the canonical `ParsedFlowRoute`. Returns
 * `{ kind: "not_found" }` when no entry matches. Iteration order matches
 * `ROUTES_BY_KIND` declaration order; same-method same-length overlaps are
 * disambiguated by literal-segment specificity (handled by
 * `path-to-regexp`).
 */
export function matchFlowRoute(method: string, path: string): ParsedFlowRoute {
  const upperMethod = method.toUpperCase();
  for (const route of FLAT_ROUTES) {
    if (route.method !== upperMethod) continue;
    const result = route.matcher(path);
    if (result === false) continue;
    const params = stringifyParams(result.params);
    return route.build(params);
  }
  return { kind: "not_found" };
}

/**
 * Compiles a transport-adapter route pattern (`:param` and trailing `*`) to
 * a path-to-regexp matcher. Adapter routes historically expose the catch-all
 * remainder as `params.rest` — joined by `/`. Preserve that contract: when
 * the legacy pattern ends in `/*`, rewrite to `/*rest` and join the captured
 * segment array on match.
 */
export function compileTransportPattern(
  pattern: string
): MatchFunction<Record<string, string | string[]>> {
  const normalized = (pattern.startsWith("/") ? pattern : `/${pattern}`).replace(
    /\/\*$/,
    "/*rest"
  );
  return match(normalized, { decode: decodeURIComponent });
}

/**
 * Match an adapter route by precompiled matcher; returns the params bag
 * with array-valued catch-all params joined on `/` (legacy contract).
 */
export function matchTransportRoute(
  matcher: MatchFunction<Record<string, string | string[]>>,
  pathname: string
): Record<string, string> | null {
  const result = matcher(pathname);
  if (result === false) return null;
  return stringifyParams(result.params);
}

function stringifyParams(
  params: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join("/") : String(value);
  }
  return out;
}
