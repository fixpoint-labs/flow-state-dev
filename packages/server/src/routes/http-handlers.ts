/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 *
 * This file is a thin orchestrator that composes route handlers from
 * domain-specific modules: session-routes, action-routes, stream-routes,
 * and state-routes.
 */
import type {
  FlowStateSettings,
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import { serializeActionSchema } from "@flow-state-dev/core/types";
import type { TracingLevel } from "@flow-state-dev/core";
import type { FlowRegistry } from "../registry/flow-registry";
import { createInMemoryStores } from "../stores";
import type { StoreRegistry } from "../stores/types";
import { detectInterruptedRequests } from "../execution/request-recovery";
import { normalizeRouteError } from "../utils/normalize-route-error";
import {
  parseFlowRoute,
  type ParsedFlowRoute
} from "./parseFlowRoute";
import {
  errorStatus,
  jsonResponse
} from "./route-utils";
import { handleAbortRequest } from "./abort-routes";
import { handleGetRequestStatus } from "./request-status-routes";
import { handleExecuteAction } from "./action-routes";
import {
  handleCheckInterruptedRequests,
  handleListActiveRequests,
  handleRetryRequest
} from "./recovery-routes";
import {
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessionRequests,
  handleListSessions,
  handlePatchSessionMetadata
} from "./session-routes";
import { handleGetSessionState } from "./state-routes";
import {
  handleGetResourceContent,
  handleGetCollectionItemContent,
  handleCreateCollectionItem,
  handleUpdateResourceContent,
  handleDeleteCollectionItem,
  handleListCollectionState,
  handleGetCollectionItemState,
  handleGetResourceManifest
} from "./resource-routes";
import { handleRequestStream, handleTranscribe } from "./stream-routes";
import {
  handleDebugListResources,
  handleDebugListCollectionItems,
  handleDebugGetResourceContent,
  handleDebugGetCollectionItemContent,
  resolveDebugConfig,
  type ResolvedDebugConfig
} from "./debug-routes";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { createInboundTransportHost } from "../transports/host/createInboundTransportHost";
import { defaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";

export type RequestContext = {
  method: string;
  path: string[];
  request: Request;
  route: ParsedFlowRoute;
};

/**
 * Internal route seam hooks used to prepare middleware-ready request/bootstrap enrichment.
 */
export type InternalRouteSeams = {
  enrichRequestContext?: (
    context: RequestContext
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  enrichActionRunInput?: (
    input: {
      flowKind: string;
      actionName: string;
      input: unknown;
      userId: string;
      sessionId?: string;
      requestId: string;
      orgId?: string;
      metadata?: Record<string, unknown>;
      signal?: AbortSignal;
    },
    context: RequestContext & { body: Record<string, unknown> }
  ) => Promise<Partial<{
    flowKind: string;
    actionName: string;
    input: unknown;
    userId: string;
    sessionId?: string;
    requestId: string;
    orgId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
  }> | void> | Partial<{
    flowKind: string;
    actionName: string;
    input: unknown;
    userId: string;
    sessionId?: string;
    requestId: string;
    orgId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
  }> | void;
};

/**
 * Default no-op internal route seams.
 */
export const NOOP_INTERNAL_ROUTE_SEAMS: InternalRouteSeams = {};

/**
 * Shared route handler options used by catch-all router adapter.
 */
export type CreateFlowRouteHandlersOptions = {
  registry: FlowRegistry;
  stores?: Partial<StoreRegistry>;
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  /** Instance-level settings threaded onto every block as `ctx.settings`. */
  settings?: FlowStateSettings;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  middleware?: Middleware[];
  onError?: (error: Error, context: { method: string; path: string }) => void;
  onBackgroundWork?: (promise: Promise<unknown>) => void;
  /**
   * Host-level fallback resolver. Per-flow `authentication.resolvePrincipal`
   * always wins over this when set. Defaults to the body-userId stub.
   */
  resolvePrincipal?: PrincipalResolver;
  internalSeams?: InternalRouteSeams;
  /**
   * Stale threshold for interrupted request detection on startup.
   * Default: 30000 (30 seconds).
   */
  staleThresholdMs?: number;
  /**
   * Whether to auto-detect interrupted requests on server startup.
   * Default: true.
   */
  detectInterruptedOnStartup?: boolean;
  /**
   * Default SSE heartbeat interval in milliseconds. Applied to every live
   * stream when the per-flow `request.sseHeartbeatMs` is unset. The wire
   * heartbeat keeps NAT/proxy idle timeouts from closing the SSE
   * connection and gives clients a robust inactivity signal.
   * Default: 15000 (15 seconds). Set to 0 to disable.
   */
  defaultSseHeartbeatMs?: number;
  /**
   * Tracing verbosity for observability snapshots (FIX-406 6H). Threaded to
   * the host and onto every block context. Unset → the runtime falls back to
   * `resolveTracingLevel()` (env / observability default).
   */
  tracingLevel?: TracingLevel;
  /**
   * HTTP header carrying the tenant id (FIX-406 6D). Default `x-tenant-id`.
   * The extracted value is threaded onto request/session context identities.
   */
  tenantIdHeader?: string;
  /**
   * Resolved debug-endpoint configuration. Threaded into the debug route
   * handlers; consult `resolveDebugConfig` in `debug-routes.ts` for the
   * env-fallback + defaults logic.
   */
  debugEndpointsEnabled?: boolean;
  debugAllowedOrigins?: string[];
  debugAllowAnonymousLocal?: boolean;
  debugCountLimit?: number;
};

const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * Context object expected by catch-all route handlers.
 */
export type FlowRouteContext = {
  path?: string[];
};

export function resolveStores(partial: Partial<StoreRegistry> | undefined): StoreRegistry {
  const fallback = createInMemoryStores();
  return {
    session: partial?.session ?? fallback.session,
    request: partial?.request ?? fallback.request,
    user: partial?.user ?? fallback.user,
    org: partial?.org ?? fallback.org,
    activeRequests: partial?.activeRequests ?? fallback.activeRequests,
    content: partial?.content ?? fallback.content,
    resourceState: partial?.resourceState ?? fallback.resourceState,
    checkpoints: partial?.checkpoints ?? fallback.checkpoints,
    traces: partial?.traces ?? fallback.traces
  };
}

/**
 * Creates method-aware route handlers for canonical `/api/flows` endpoints.
 *
 * Constructs an `InboundTransportHost` internally and routes action
 * execution through `host.dispatch`; non-action routes (sessions, streams,
 * resources, etc.) read from the same host's stores and registry directly.
 */
export function createFlowRouteHandlers(options: CreateFlowRouteHandlersOptions): {
  handle: (request: Request, context: FlowRouteContext) => Promise<Response>;
  host: InboundTransportHost;
} {
  const stores = resolveStores(options.stores);
  const debugConfig: ResolvedDebugConfig = resolveDebugConfig({
    debugEndpointsEnabled: options.debugEndpointsEnabled,
    debugAllowedOrigins: options.debugAllowedOrigins,
    debugAllowAnonymousLocal: options.debugAllowAnonymousLocal,
    debugCountLimit: options.debugCountLimit
  });
  // FIX-569: the legacy active-streams registry (and its `maxConcurrentStreams`
  // / `staleStreamTtlMs` knobs) is gone. Live tail is owned by the store
  // interface; long-running flows are no longer at risk of registry eviction.
  // The options remain on `CreateFlowRouteHandlersOptions` for source-compat
  // but have no effect.
  void options.maxConcurrentStreams;
  void options.staleStreamTtlMs;
  const seams = options.internalSeams ?? NOOP_INTERNAL_ROUTE_SEAMS;

  const defaultSseHeartbeatMs =
    options.defaultSseHeartbeatMs !== undefined
      ? options.defaultSseHeartbeatMs
      : DEFAULT_SSE_HEARTBEAT_MS;

  const host: InboundTransportHost = createInboundTransportHost({
    registry: options.registry,
    stores,
    modelResolver: options.modelResolver,
    speechResolver: options.speechResolver,
    transcriptionResolver: options.transcriptionResolver,
    settings: options.settings,
    middleware: options.middleware,
    resolvePrincipal: options.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver,
    onBackgroundWork: options.onBackgroundWork,
    maxResponseBufferSize: options.maxResponseBufferSize,
    defaultSseHeartbeatMs,
    tracingLevel: options.tracingLevel
  });

  // Detect interrupted requests from previous runs on startup
  if (options.detectInterruptedOnStartup !== false) {
    void detectInterruptedRequests({
      stores,
      staleThresholdMs: options.staleThresholdMs
    }).then((interrupted) => {
      if (interrupted.length > 0) {
        console.warn(
          `[flow-state] detected ${interrupted.length} interrupted request(s) from previous run`,
          interrupted.map((i) => i.entry.requestId)
        );
      }
    }).catch((err) => {
      console.error("[flow-state] failed to detect interrupted requests on startup", err);
    });
  }

  const handle = async (
    request: Request,
    context: FlowRouteContext
  ): Promise<Response> => {
    const path = Array.isArray(context.path) ? context.path : [];
    const route = parseFlowRoute(request.method, path);
    const requestContext: RequestContext = {
      method: request.method.toUpperCase(),
      path,
      request,
      route
    };

    const bootstrapMetadata =
      (await seams.enrichRequestContext?.(requestContext)) ?? {};
    const bootstrapPath = `/api/flows/${path.join("/")}`;

    try {
      if (route.kind === "not_found") {
        return jsonResponse(404, { error: "Route not found" });
      }

      if (route.kind === "list_flows") {
        return jsonResponse(200, {
          flows: options.registry.list().map((flow) => ({
            id: flow.id,
            kind: flow.kind,
            requireUser: flow.requireUser,
            requiresOrg: flow.requiresOrg,
            actions: Object.keys(flow.actions),
            actionSchemas: Object.fromEntries(
              Object.entries(flow.actions).map(([name, config]) => [
                name,
                serializeActionSchema(config.inputSchema ?? config.block.inputSchema)
              ])
            )
          }))
        });
      }

      if (route.kind === "capabilities") {
        return jsonResponse(200, { userStream: false });
      }

      if (route.kind === "execute_action") {
        return await handleExecuteAction(request, route, {
          host,
          registry: options.registry,
          stores,
          seams,
          bootstrapMetadata,
          requestContext,
          tenantIdHeader: options.tenantIdHeader
        });
      }

      if (route.kind === "request_stream") {
        return await handleRequestStream(request, route, {
          registry: options.registry,
          stores,
          transcriptionResolver: options.transcriptionResolver,
          defaultSseHeartbeatMs
        });
      }

      if (route.kind === "list_sessions") {
        return await handleListSessions(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_session") {
        return await handleGetSession(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "list_session_requests") {
        return await handleListSessionRequests(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_session_state") {
        return await handleGetSessionState(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "create_session") {
        return await handleCreateSession(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "delete_session") {
        return await handleDeleteSession(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "patch_session_metadata") {
        return await handlePatchSessionMetadata(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "user_stream") {
        return jsonResponse(501, {
          error: "User stream is not enabled in Phase 1"
        });
      }

      if (route.kind === "transcribe") {
        return await handleTranscribe(request, route, {
          registry: options.registry,
          stores,
          transcriptionResolver: options.transcriptionResolver
        });
      }

      if (route.kind === "retry_request") {
        return await handleRetryRequest(request, route, {
          registry: options.registry,
          stores,
          modelResolver: options.modelResolver,
          speechResolver: options.speechResolver,
          middleware: options.middleware
        });
      }

      if (route.kind === "abort_request") {
        return await handleAbortRequest(request, route, {
          stores
        });
      }

      if (route.kind === "request_status") {
        return await handleGetRequestStatus(request, route, {
          stores
        });
      }

      if (route.kind === "active_requests") {
        return await handleListActiveRequests(request, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "check_interrupted_requests") {
        return await handleCheckInterruptedRequests(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_resource_content") {
        return await handleGetResourceContent(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_collection_item_content") {
        return await handleGetCollectionItemContent(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "create_collection_item") {
        return await handleCreateCollectionItem(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "update_resource_content") {
        return await handleUpdateResourceContent(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "delete_collection_item") {
        return await handleDeleteCollectionItem(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "list_collection_state") {
        return await handleListCollectionState(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_collection_item_state") {
        return await handleGetCollectionItemState(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "get_resource_manifest") {
        return await handleGetResourceManifest(request, route, {
          registry: options.registry,
          stores
        });
      }

      if (route.kind === "debug_list_resources") {
        return await handleDebugListResources(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig
        });
      }

      if (route.kind === "debug_list_collection_items") {
        return await handleDebugListCollectionItems(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig
        });
      }

      if (route.kind === "debug_get_resource_content") {
        return await handleDebugGetResourceContent(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig
        });
      }

      if (route.kind === "debug_get_collection_item_content") {
        return await handleDebugGetCollectionItemContent(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig
        });
      }

      return jsonResponse(404, { error: "Route not found" });
    } catch (error) {
      const normalized = normalizeRouteError(error);
      options.onError?.(normalized, {
        method: request.method.toUpperCase(),
        path: bootstrapPath
      });

      return jsonResponse(errorStatus(normalized), {
        error: normalized.message
      });
    }
  };

  return {
    handle,
    host
  };
}
