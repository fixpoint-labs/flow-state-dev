/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 *
 * This file is a thin orchestrator that composes route handlers from
 * domain-specific modules: session-routes, action-routes, stream-routes,
 * and state-routes.
 */
import type {
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import { serializeActionSchema } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import { createInMemoryStores } from "../stores";
import type { StoreRegistry } from "../stores/types";
import { detectInterruptedRequests } from "../execution/request-recovery";
import { configureActiveStreamRegistry } from "../streaming/active-streams";
import { normalizeRouteError } from "../utils/normalize-route-error";
import {
  parseFlowRoute,
  type ParsedFlowRoute
} from "./parseFlowRoute";
import {
  errorStatus,
  jsonResponse
} from "./route-utils";
import { handleExecuteAction } from "./action-routes";
import { handleListActiveRequests, handleRetryRequest } from "./recovery-routes";
import {
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessionRequests,
  handleListSessions,
  handlePatchSessionMetadata
} from "./session-routes";
import { handleGetSessionState } from "./state-routes";
import { handleRequestStream, handleTranscribe } from "./stream-routes";

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
      projectId?: string;
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
    projectId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
  }> | void> | Partial<{
    flowKind: string;
    actionName: string;
    input: unknown;
    userId: string;
    sessionId?: string;
    requestId: string;
    projectId?: string;
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
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  middleware?: Middleware[];
  onError?: (error: Error, context: { method: string; path: string }) => void;
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
};

/**
 * Context object expected by catch-all route handlers.
 */
export type FlowRouteContext = {
  path?: string[];
};

function resolveStores(partial: Partial<StoreRegistry> | undefined): StoreRegistry {
  const fallback = createInMemoryStores();
  return {
    session: partial?.session ?? fallback.session,
    request: partial?.request ?? fallback.request,
    user: partial?.user ?? fallback.user,
    project: partial?.project ?? fallback.project,
    activeRequests: partial?.activeRequests ?? fallback.activeRequests
  };
}

/**
 * Creates method-aware route handlers for canonical `/api/flows` endpoints.
 */
export function createFlowRouteHandlers(options: CreateFlowRouteHandlersOptions): {
  handle: (request: Request, context: FlowRouteContext) => Promise<Response>;
} {
  const stores = resolveStores(options.stores);
  configureActiveStreamRegistry({
    maxConcurrentStreams: options.maxConcurrentStreams,
    staleStreamTtlMs: options.staleStreamTtlMs,
    onWarning: (message, detail) => {
      console.warn(`[flow-state] ${message}`, detail);
    }
  });
  const seams = options.internalSeams ?? NOOP_INTERNAL_ROUTE_SEAMS;

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
            actions: Object.keys(flow.actions),
            actionSchemas: Object.fromEntries(
              Object.entries(flow.actions).map(([name, config]) => [
                name,
                serializeActionSchema(config.inputSchema)
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
          registry: options.registry,
          stores,
          modelResolver: options.modelResolver,
          speechResolver: options.speechResolver,
          middleware: options.middleware,
          maxResponseBufferSize: options.maxResponseBufferSize,
          seams,
          bootstrapMetadata,
          requestContext
        });
      }

      if (route.kind === "request_stream") {
        return await handleRequestStream(request, route, {
          registry: options.registry,
          stores,
          transcriptionResolver: options.transcriptionResolver
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

      if (route.kind === "active_requests") {
        return await handleListActiveRequests(request, {
          registry: options.registry,
          stores
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
    handle
  };
}
