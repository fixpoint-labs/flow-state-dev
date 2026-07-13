/**
 * MCP transport adapter — exposes every flow with `mcp.enabled: true`
 * as its own MCP server over Streamable HTTP. The canonical endpoint is
 * `POST /api/flows/:kind/mcp` (per FIX-22); callers may opt into a dedicated
 * `POST /mcp/:kind` layout.
 *
 * v1 design choices (see FIX-22 spec § 1):
 *   - Stateless only. No `Mcp-Session-Id` is issued; every `tools/call`
 *     creates a fresh flow session under `host.dispatch`. Stateful mode
 *     is deferred until a real consumer asks for it.
 *   - Single JSON response on `tools/call`. No progress notifications,
 *     no SSE response stream, no `outputSchema`/`structuredContent`.
 *   - Hand-rolled JSON-RPC dispatch. The spec called for the
 *     `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` plus
 *     a WHATWG↔Node IncomingMessage shim. For v1 (six methods, single
 *     response, stateless) the shim was more code than the dispatch
 *     itself. When stateful mode lands and the SDK ships a WHATWG-
 *     native transport we revisit.
 *   - Resources surface returns the empty list pending a true flow
 *     scope in the resource model — `unstable_listExposedResources`
 *     is wired through and ready to fill in.
 *
 * The adapter is mounted alongside the HTTP adapter via
 * `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`.
 * Per the FIX-438 contract, all action execution still flows through
 * `host.dispatch` — the runtime below this layer is identical to HTTP.
 */
import type {
  InboundTransportAdapter,
  InboundTransportHost,
  TransportBindings,
  TransportRoute,
  PrincipalResolutionContext,
  ResolvedPrincipal
} from "@flow-state-dev/engine";
import {
  ConcurrencyQueueTimeoutError,
  ConcurrencyRejectedError,
  PrincipalResolutionError
} from "@flow-state-dev/engine";
import {
  unstable_findResourceConfig,
  unstable_getPersistedData,
  unstable_isCollectionConfig,
  unstable_listExposedResources,
  unstable_renderContent
} from "@flow-state-dev/engine";
import type { ActionConfig, McpConfig } from "@flow-state-dev/core/types";
import {
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_RESOURCE_DENIED,
  JSON_RPC_SERVER_BUSY,
  JSON_RPC_UNAUTHORIZED,
  jsonRpcError,
  type JsonRpcError
} from "./errors";
import {
  actionToMcpTool,
  resolveExposedActions,
  type McpTool
} from "./tool-conversion";
import { toolResultFromExecution } from "./result-formatting";

/** Stable provenance identifier stamped onto every MCP-originated request. */
export const MCP_TRANSPORT_SOURCE = "mcp";

/**
 * MCP protocol versions this adapter understands. Ordered newest-first;
 * the initialize handler picks the client's requested version when it is
 * one of these and otherwise falls back to the oldest compat version per
 * the spec's negotiation guidance.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const MCP_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const MCP_FALLBACK_PROTOCOL_VERSION = "2025-03-26";

export interface CreateMcpTransportAdapterOptions {
  /**
   * Endpoint base path. Defaults to `/api/flows`, or `/mcp` when
   * `dedicatedBasePath` is enabled.
   */
  basePath?: string;
  /**
   * Treat `basePath` as MCP-exclusive and mount at `<basePath>/:kind`
   * instead of `<basePath>/:kind/mcp`. Defaults to `false`.
   */
  dedicatedBasePath?: boolean;
  /**
   * Origin allowlist for cross-origin clients. Defaults to "same-origin
   * only" — the adapter responds 403 to any request carrying an
   * `Origin` header that does not match the request URL's origin. Pass
   * `"*"` to allow any origin (only use for local development), or an
   * explicit list of origin strings.
   */
  allowedOrigins?: string[] | "*";
  /**
   * Allowlist of endpoint query-string params to forward into the
   * `tools/call` action input. When a request URL carries one of these params
   * (e.g. `.../mcp?source=claude-desktop`), its value is merged into the
   * dispatched tool input under the same key. This is the seam for
   * **installation-level** values an operator sets once on the endpoint URL,
   * rather than per-call arguments the model supplies.
   *
   * The forwarded value is **authoritative**: it overrides a same-named
   * argument in the tool call, since the point is provenance the model should
   * not be able to override. Listing a param name is the operator's explicit
   * opt-in that it becomes endpoint-controlled. A forwarded param only takes
   * effect if the target action's input schema accepts it — otherwise the
   * existing zod boundary strips or rejects it, exactly as for any other input
   * key. Only `tools/call` is affected; `initialize` / `tools/list` /
   * `resources/*` and auth are untouched. Defaults to forwarding nothing.
   */
  forwardQueryParams?: string[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/**
 * Construct the MCP transport adapter. Pure synchronous factory — the
 * returned `InboundTransportAdapter` is mounted by `createFlowApiRouter`
 * via the `adapters` option.
 */
export function createMcpTransportAdapter(
  options: CreateMcpTransportAdapterOptions = {}
): InboundTransportAdapter {
  const dedicatedBasePath = options.dedicatedBasePath ?? false;
  const basePath = (
    options.basePath ?? (dedicatedBasePath ? "/mcp" : "/api/flows")
  ).replace(/\/$/, "");
  const allowedOrigins = options.allowedOrigins;
  const forwardQueryParams = options.forwardQueryParams;

  return {
    source: MCP_TRANSPORT_SOURCE,
    createBindings(host: InboundTransportHost): TransportBindings {
      const path = dedicatedBasePath
        ? `${basePath}/:kind`
        : `${basePath}/:kind/mcp`;

      const post: TransportRoute = {
        method: "POST",
        path,
        handler: (req, ctx) => handlePost(host, req, ctx, allowedOrigins, forwardQueryParams)
      };
      const get: TransportRoute = {
        method: "GET",
        path,
        handler: () => Promise.resolve(methodNotAllowed())
      };
      const del: TransportRoute = {
        method: "DELETE",
        path,
        handler: () => Promise.resolve(methodNotAllowed())
      };

      return { routes: [post, get, del] };
    }
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

async function handlePost(
  host: InboundTransportHost,
  request: Request,
  ctx: { params: Record<string, string> },
  allowedOrigins: CreateMcpTransportAdapterOptions["allowedOrigins"],
  forwardQueryParams: CreateMcpTransportAdapterOptions["forwardQueryParams"]
): Promise<Response> {
  const kind = ctx.params.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    return jsonRpcResponse(null, jsonRpcError(JSON_RPC_INVALID_REQUEST, "Missing flow kind in path."));
  }

  const originCheck = checkOrigin(request, allowedOrigins);
  if (originCheck !== null) return originCheck;

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcResponse(null, jsonRpcError(JSON_RPC_PARSE_ERROR, "Invalid JSON body."));
  }

  if (body === null || typeof body !== "object" || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcResponse(
      typeof body?.id === "string" || typeof body?.id === "number" ? body.id : null,
      jsonRpcError(JSON_RPC_INVALID_REQUEST, "Malformed JSON-RPC envelope.")
    );
  }

  const isNotification = body.id === undefined || body.id === null;
  const id = isNotification ? null : body.id ?? null;

  // `notifications/initialized` is the only notification we explicitly
  // expect; everything else falls through to the regular dispatch path.
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (body.method === "ping") {
    return jsonRpcResponse(id, undefined, {});
  }
  if (body.method === "initialize") {
    return jsonRpcResponse(id, undefined, buildInitializeResult(kind, body.params));
  }

  const flow = host.registry.get(kind);
  if (flow === undefined || flow.mcp?.enabled !== true) {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Flow "${kind}" is not exposed via MCP.`));
  }

  // Resolve principal once per request. The same context + adapter are
  // reused across `tools/list` / `resources/list` / `tools/call` so the
  // behavior matches the HTTP adapter (auth at the request boundary).
  let principal: ResolvedPrincipal;
  try {
    const principalContext: PrincipalResolutionContext = {
      source: MCP_TRANSPORT_SOURCE,
      request,
      envelope: {
        flowKind: kind,
        action: body.method === "tools/call" ? extractToolName(body.params) ?? "(unknown)" : "(metadata)",
        input: body.params,
        metadata: { mcpMethod: body.method }
      }
    };
    principal = await host.resolvePrincipal(principalContext);
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      const status = error.status ?? 401;
      return jsonRpcResponse(
        id,
        jsonRpcError(JSON_RPC_UNAUTHORIZED, error.message),
        undefined,
        status,
        status === 401
          ? { "WWW-Authenticate": 'Bearer realm="MCP"' }
          : undefined
      );
    }
    throw error;
  }

  switch (body.method) {
    case "tools/list":
      return jsonRpcResponse(id, undefined, { tools: listTools(flow.kind, flow.actions) });

    case "tools/call":
      return await handleToolsCall(
        host,
        flow,
        principal,
        body.params,
        id,
        extractForwardedParams(request, forwardQueryParams)
      );

    case "resources/list":
      return jsonRpcResponse(id, undefined, {
        resources: await listResources(flow, host)
      });

    case "resources/read":
      return await handleResourcesRead(host, flow, body.params, id);

    case "resources/subscribe":
    case "resources/unsubscribe":
      return jsonRpcResponse(
        id,
        jsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `MCP method "${body.method}" is not supported in v1.`)
      );

    default:
      return jsonRpcResponse(id, jsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Unknown MCP method "${body.method}".`));
  }
}

// ---------------------------------------------------------------------------
// initialize / tools/list / resources/list
// ---------------------------------------------------------------------------

function buildInitializeResult(flowKind: string, params: unknown): {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
} {
  // Negotiate the protocol version per spec: only echo back a version we
  // actually support. If the client requests one we do not implement,
  // respond with our newest supported version so the client can decide
  // whether to continue or disconnect.
  const requested =
    params !== null && typeof params === "object"
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;
  const protocolVersion =
    typeof requested === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : requested === undefined
        ? MCP_FALLBACK_PROTOCOL_VERSION
        : MCP_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false }
    },
    serverInfo: {
      name: flowKind,
      version: "1.0.0"
    }
  };
}

function listTools(
  flowKind: string,
  actions: Record<string, ActionConfig>
): McpTool[] {
  const exposed = resolveExposedActions(flowKind, actions);
  const tools: McpTool[] = [];
  for (const [toolName, { action }] of exposed) {
    tools.push(actionToMcpTool(toolName, action));
  }
  return tools;
}

async function listResources(
  flow: { kind: string; resources?: unknown; isolateUserState?: boolean; isolateOrgState?: boolean; mcp?: McpConfig },
  host: InboundTransportHost
): Promise<Array<{ uri: string; name: string; description?: string; mimeType: string }>> {
  if (flow.mcp?.exposeResources === false) return [];
  const entries = await unstable_listExposedResources(flow, {
    registry: host.registry,
    stores: host.stores
  });
  return entries.map((entry) => ({
    uri: entry.uri,
    name: entry.name,
    description: entry.description,
    mimeType: entry.mimeType
  }));
}

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

async function handleToolsCall(
  host: InboundTransportHost,
  flow: { kind: string; actions: Record<string, ActionConfig>; mcp?: McpConfig },
  principal: ResolvedPrincipal,
  params: unknown,
  id: string | number | null,
  forwardedInput: Record<string, string> | undefined
): Promise<Response> {
  if (params === null || typeof params !== "object") {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_INVALID_PARAMS, "tools/call requires params."));
  }
  const { name, arguments: args } = params as { name?: unknown; arguments?: unknown };
  if (typeof name !== "string" || name.length === 0) {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_INVALID_PARAMS, "tools/call params.name must be a string."));
  }

  const exposed = resolveExposedActions(flow.kind, flow.actions);
  const target = exposed.get(name);
  if (target === undefined) {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Unknown MCP tool "${name}".`));
  }

  // Merge any forwarded endpoint query params on top of the model's arguments —
  // the query value is authoritative (installation-set provenance). A call with
  // NO arguments (omitted or null) is a valid empty call, so forwarded params
  // still merge onto {} rather than being dropped. A non-plain-object `arguments`
  // (a primitive or an array — a malformed call) is passed through UNCHANGED so
  // it reaches the zod boundary with the same error whether or not forwarding is
  // configured; attaching a forwarded key to a call that will fail validation
  // anyway buys nothing, would mask the real "arguments must be an object" error,
  // and (for an array) would spread it into bogus numeric keys.
  const hasNoArguments = args === undefined || args === null;
  const isPlainObject = args !== null && typeof args === "object" && !Array.isArray(args);
  const input =
    forwardedInput === undefined
      ? args ?? {}
      : hasNoArguments || isPlainObject
        ? { ...((args ?? {}) as Record<string, unknown>), ...forwardedInput }
        : args;

  let handle: ReturnType<InboundTransportHost["dispatch"]>;
  try {
    handle = host.dispatch({
      source: MCP_TRANSPORT_SOURCE,
      flowKind: flow.kind,
      action: target.actionKey,
      input,
      principal,
      // MCP v1 is stateless — every tools/call creates a fresh session.
      sessionId: undefined,
      // No SSE response stream in v1; the runtime can still emit items
      // for observability without a live stream consumer.
      responseEmitter: null,
      metadata: { mcpMethod: "tools/call", mcpToolName: name }
    });
  } catch (error) {
    // Concurrency `reject`: another request holds this action's key. Like a
    // capacity overflow, this is a transient busy condition — map to the
    // server-busy code (retryable) so MCP clients back off.
    if (error instanceof ConcurrencyRejectedError) {
      return jsonRpcResponse(
        id,
        jsonRpcError(JSON_RPC_SERVER_BUSY, error.message, { retryable: true })
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    // Capacity overflow is the documented framework signal for "the host
    // is at its concurrent-stream cap." Map to the JSON-RPC server-busy
    // code so MCP clients can implement back-off.
    if (/capacity|busy|stream cap/i.test(message)) {
      return jsonRpcResponse(
        id,
        jsonRpcError(JSON_RPC_SERVER_BUSY, message, { retryable: true })
      );
    }
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_INVALID_PARAMS, message));
  }

  let result;
  try {
    result = await handle.finished;
  } catch (error) {
    // A `queue` policy that waits past its budget rejects `finished` (not the
    // synchronous `dispatch` above) with `ConcurrencyQueueTimeoutError`. Map it
    // to the retryable server-busy code, the same family as a `reject` drop, so
    // the MCP client backs off rather than seeing a transport-level failure.
    if (error instanceof ConcurrencyQueueTimeoutError) {
      return jsonRpcResponse(
        id,
        jsonRpcError(JSON_RPC_SERVER_BUSY, error.message, { retryable: true })
      );
    }
    throw error;
  }
  return jsonRpcResponse(id, undefined, toolResultFromExecution(result));
}

// ---------------------------------------------------------------------------
// resources/read
// ---------------------------------------------------------------------------

async function handleResourcesRead(
  host: InboundTransportHost,
  flow: { kind: string; resources?: unknown; isolateUserState?: boolean; isolateOrgState?: boolean },
  params: unknown,
  id: string | number | null
): Promise<Response> {
  if (params === null || typeof params !== "object") {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_INVALID_PARAMS, "resources/read requires params."));
  }
  const uri = (params as { uri?: unknown }).uri;
  if (typeof uri !== "string" || uri.length === 0) {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_INVALID_PARAMS, "resources/read params.uri is required."));
  }

  // Expected URI: `flow://<kind>/resources/<ref>`
  const parsed = parseFlowResourceUri(uri);
  if (parsed === null || parsed.kind !== flow.kind) {
    return jsonRpcResponse(
      id,
      jsonRpcError(JSON_RPC_RESOURCE_DENIED, `Resource URI "${uri}" is not exposed at this endpoint.`)
    );
  }

  const found = unstable_findResourceConfig(flow, parsed.ref);
  if (found === undefined) {
    return jsonRpcResponse(id, jsonRpcError(JSON_RPC_RESOURCE_DENIED, `Unknown resource "${parsed.ref}".`));
  }
  const { config, scope } = found;
  if (unstable_isCollectionConfig(config)) {
    return jsonRpcResponse(
      id,
      jsonRpcError(JSON_RPC_RESOURCE_DENIED, "Collection resources are not exposed via MCP in v1.")
    );
  }
  if (config.client?.content?.read !== true) {
    return jsonRpcResponse(
      id,
      jsonRpcError(JSON_RPC_RESOURCE_DENIED, `Resource "${parsed.ref}" is not exposed (client.content.read is not true).`)
    );
  }

  // v1 has no flow-bound scope, and stateless MCP has no sessionId to
  // hand to scope-bound storage. When `unstable_listExposedResources`
  // grows to surface entries, this path will follow.
  void unstable_getPersistedData;
  void unstable_renderContent;
  void scope;

  return jsonRpcResponse(
    id,
    jsonRpcError(JSON_RPC_RESOURCE_DENIED, "No flow-bound resource is currently readable in stateless MCP v1.")
  );
}

function parseFlowResourceUri(uri: string): { kind: string; ref: string } | null {
  // flow://<kind>/resources/<ref>
  const match = uri.match(/^flow:\/\/([^/]+)\/resources\/(.+)$/);
  if (match === null) return null;
  return { kind: decodeURIComponent(match[1] ?? ""), ref: decodeURIComponent(match[2] ?? "") };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonRpcResponse(
  id: string | number | null,
  error?: JsonRpcError,
  result?: unknown,
  status: number = 200,
  extraHeaders?: Record<string, string>
): Response {
  const body: Record<string, unknown> = { jsonrpc: "2.0", id };
  if (error !== undefined) body.error = error;
  else body.result = result ?? {};
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders ?? {})
    }
  });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" }
  });
}

function checkOrigin(
  request: Request,
  allowedOrigins: CreateMcpTransportAdapterOptions["allowedOrigins"]
): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null; // non-browser client; nothing to enforce
  if (allowedOrigins === "*") return null;
  if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) return null;
  // Same-origin check: compare the Origin header with the request URL's origin.
  try {
    const requestOrigin = new URL(request.url).origin;
    if (origin === requestOrigin) return null;
  } catch {
    // Fall through to the 403 below if the URL is unparseable.
  }
  return new Response("Origin not allowed", { status: 403 });
}

function extractToolName(params: unknown): string | undefined {
  if (params === null || typeof params !== "object") return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Read the allowlisted query params off the request URL into a plain object to
 * merge into the tool input. Returns `undefined` when nothing is configured or
 * present, so the caller can pass the model's arguments through untouched.
 * Repeated params collapse to the first value (`searchParams.get`).
 */
function extractForwardedParams(
  request: Request,
  allow: CreateMcpTransportAdapterOptions["forwardQueryParams"]
): Record<string, string> | undefined {
  if (allow === undefined || allow.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const key of allow) {
    const value = url.searchParams.get(key);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
