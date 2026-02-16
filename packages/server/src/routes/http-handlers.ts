/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 */
import type { RequestStatusEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import type { JsonObject } from "@flow-state-dev/core/types";
import { FlowError, ValidationError } from "../errors/flow-error";
import { runAction } from "../execution/runAction";
import { type FlowRegistry } from "../registry/flow-registry";
import { createInMemoryStores } from "../stores";
import type {
  RequestRecord,
  SessionRecord,
  StoreRegistry
} from "../stores/types";
import { encodeStreamEvent } from "../streaming/encode-event";
import { replayRequestEvents } from "../streaming/resume";
import {
  parseFlowRoute,
  type ParsedFlowRoute
} from "./parseFlowRoute";

type RequestContext = {
  method: string;
  path: string[];
  request: Request;
  route: ParsedFlowRoute;
};

type ActionRunInput = {
  flowKind: string;
  actionName: string;
  input: unknown;
  userId: string;
  sessionId?: string;
  requestId: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * Internal route seam hooks used to prepare middleware-ready request/bootstrap enrichment.
 */
export type InternalRouteSeams = {
  enrichRequestContext?: (
    context: RequestContext
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  enrichActionRunInput?: (
    input: ActionRunInput,
    context: RequestContext & { body: Record<string, unknown> }
  ) => Promise<Partial<ActionRunInput> | void> | Partial<ActionRunInput> | void;
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
  onError?: (error: Error, context: { method: string; path: string }) => void;
  internalSeams?: InternalRouteSeams;
};

/**
 * Context object expected by catch-all route handlers.
 */
export type FlowRouteContext = {
  path?: string[];
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive"
};

function resolveStores(partial: Partial<StoreRegistry> | undefined): StoreRegistry {
  const fallback = createInMemoryStores();
  return {
    session: partial?.session ?? fallback.session,
    request: partial?.request ?? fallback.request,
    user: partial?.user ?? fallback.user,
    project: partial?.project ?? fallback.project
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function getPositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function requestStatusEventType(status: RequestRecord["status"]): RequestStatusEvent["type"] {
  if (status === "completed") {
    return "request.completed";
  }

  if (status === "failed") {
    return "request.failed";
  }

  if (status === "incomplete") {
    return "request.incomplete";
  }

  return "request.in_progress";
}

function buildReplayEvents(record: RequestRecord): RequestStreamEvent[] {
  const createdAt = record.startedAtMs ?? record.createdAt;
  const statusTs =
    record.completedAtMs ??
    record.failedAtMs ??
    record.updatedAt ??
    createdAt;

  return [
    {
      stream: "request",
      type: "request.created",
      requestId: record.id,
      sequence_number: 1,
      status: "in_progress",
      ts: createdAt
    },
    {
      stream: "request",
      type: requestStatusEventType(record.status),
      requestId: record.id,
      sequence_number: 2,
      status: record.status,
      ts: statusTs
    }
  ];
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }

  return new Error("Unknown route error");
}

function errorStatus(error: Error): number {
  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof FlowError && error.code === "validation_error") {
    return 400;
  }

  return 500;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(text);
  const object = asObject(parsed);
  if (object === undefined) {
    throw new ValidationError("Request body must be a JSON object", {
      scope: "request"
    });
  }

  return object;
}

/**
 * Creates method-aware route handlers for canonical `/api/flows` endpoints.
 */
export function createFlowRouteHandlers(options: CreateFlowRouteHandlersOptions): {
  handle: (request: Request, context: FlowRouteContext) => Promise<Response>;
} {
  const stores = resolveStores(options.stores);
  const seams = options.internalSeams ?? NOOP_INTERNAL_ROUTE_SEAMS;

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
        return jsonResponse(404, {
          error: "Route not found"
        });
      }

      if (route.kind === "list_flows") {
        return jsonResponse(200, {
          flows: options.registry.list().map((flow) => ({
            id: flow.id,
            kind: flow.kind,
            requireSession: flow.requireSession,
            requireUser: flow.requireUser,
            actions: Object.keys(flow.actions)
          }))
        });
      }

      if (route.kind === "capabilities") {
        return jsonResponse(200, {
          userStream: false
        });
      }

      if (route.kind === "execute_action") {
        const flow = options.registry.get(route.flowKind);
        if (flow === undefined) {
          return jsonResponse(404, {
            error: `Unknown flow "${route.flowKind}"`
          });
        }

        const body = await parseJsonBody(request);
        const userId = getString(body.userId);
        if (userId === undefined) {
          return jsonResponse(400, {
            error: "Action request requires non-empty userId"
          });
        }

        const sessionId = route.sessionId ?? getString(body.sessionId);
        const metadata = asObject(body.metadata);
        const actionInput: ActionRunInput = {
          flowKind: flow.kind,
          actionName: route.actionName,
          input: body.input,
          userId,
          sessionId,
          requestId: getString(body.requestId) ?? generateId("req"),
          projectId: getString(body.projectId),
          metadata: {
            ...bootstrapMetadata,
            ...(metadata ?? {})
          },
          signal: request.signal
        };

        const actionOverrides =
          (await seams.enrichActionRunInput?.(actionInput, {
            ...requestContext,
            body
          })) ?? {};

        const resolvedActionInput: ActionRunInput = {
          ...actionInput,
          ...actionOverrides,
          metadata: {
            ...(actionInput.metadata ?? {}),
            ...(actionOverrides.metadata ?? {})
          }
        };

        const result = await runAction({
          flow,
          actionName: resolvedActionInput.actionName as keyof typeof flow.actions & string,
          input: resolvedActionInput.input,
          userId: resolvedActionInput.userId,
          sessionId: resolvedActionInput.sessionId,
          requestId: resolvedActionInput.requestId,
          projectId: resolvedActionInput.projectId,
          metadata: resolvedActionInput.metadata,
          signal: resolvedActionInput.signal,
          stores
        });

        const persistedRequest = await stores.request.get(
          resolvedActionInput.requestId
        );
        const requestStatus =
          persistedRequest?.status ?? (result.error === undefined ? "completed" : "failed");

        return jsonResponse(200, {
          status: requestStatus,
          request: {
            id: resolvedActionInput.requestId,
            flowKind: flow.kind,
            actionName: resolvedActionInput.actionName,
            status: requestStatus
          },
          session:
            resolvedActionInput.sessionId === undefined
              ? undefined
              : {
                  id: resolvedActionInput.sessionId
                },
          error: result.error?.message
        });
      }

      if (route.kind === "request_stream") {
        const flow = options.registry.get(route.flowKind);
        if (flow === undefined) {
          return jsonResponse(404, {
            error: `Unknown flow "${route.flowKind}"`
          });
        }

        const requestRecord = await stores.request.get(route.requestId);
        if (
          requestRecord === undefined ||
          requestRecord.flowKind !== flow.kind
        ) {
          return jsonResponse(404, {
            error: `Unknown request "${route.requestId}"`
          });
        }

        const url = new URL(request.url);
        const replay = replayRequestEvents({
          requestId: route.requestId,
          events: buildReplayEvents(requestRecord),
          lastEventId: request.headers.get("last-event-id"),
          startingAfter: url.searchParams.get("starting_after")
        });
        const payload = replay.map((event) => encodeStreamEvent(event)).join("");

        return new Response(payload, {
          status: 200,
          headers: SSE_HEADERS
        });
      }

      if (route.kind === "list_sessions") {
        const url = new URL(request.url);
        const sessions = await stores.session.list({
          flowKind: getString(url.searchParams.get("flowKind")),
          userId: getString(url.searchParams.get("userId")),
          limit: getPositiveInteger(url.searchParams.get("limit")),
          offset: getPositiveInteger(url.searchParams.get("offset"))
        });

        return jsonResponse(200, {
          sessions
        });
      }

      if (route.kind === "get_session") {
        const session = await stores.session.get(route.sessionId);
        if (session === undefined) {
          return jsonResponse(404, {
            error: `Unknown session "${route.sessionId}"`
          });
        }

        return jsonResponse(200, {
          session
        });
      }

      if (route.kind === "list_session_requests") {
        const session = await stores.session.get(route.sessionId);
        if (session === undefined) {
          return jsonResponse(404, {
            error: `Unknown session "${route.sessionId}"`
          });
        }

        const url = new URL(request.url);
        const requests = await stores.request.list({
          sessionId: route.sessionId,
          status: getString(url.searchParams.get("status")) as
            | RequestRecord["status"]
            | undefined,
          limit: getPositiveInteger(url.searchParams.get("limit")),
          offset: getPositiveInteger(url.searchParams.get("offset"))
        });

        return jsonResponse(200, {
          requests
        });
      }

      if (route.kind === "get_session_state") {
        const session = await stores.session.get(route.sessionId);
        if (session === undefined) {
          return jsonResponse(404, {
            error: `Unknown session "${route.sessionId}"`
          });
        }

        const latestRequest = (
          await stores.request.list({
            sessionId: session.id,
            limit: 1
          })
        )[0];
        const user = await stores.user.get(session.userId);
        const project =
          session.projectId === undefined
            ? undefined
            : await stores.project.get(session.projectId);

        return jsonResponse(200, {
          sessionId: session.id,
          flowKind: session.flowKind,
          state: {
            request: latestRequest?.state,
            session: session.state,
            user: user?.state,
            project: project?.state
          },
          resources: [],
          projections: {}
        });
      }

      if (route.kind === "create_session") {
        const flow = options.registry.get(route.flowKind);
        if (flow === undefined) {
          return jsonResponse(404, {
            error: `Unknown flow "${route.flowKind}"`
          });
        }

        const body = await parseJsonBody(request);
        const userId = getString(body.userId);
        if (userId === undefined) {
          return jsonResponse(400, {
            error: "Session creation requires non-empty userId"
          });
        }

        const now = Date.now();
        const sessionId = getString(body.sessionId) ?? generateId("sess");
        const existing = await stores.session.get(sessionId);
        if (existing !== undefined) {
          return jsonResponse(409, {
            error: `Session "${sessionId}" already exists`
          });
        }

        const record: SessionRecord = {
          id: sessionId,
          flowKind: flow.kind,
          userId,
          projectId: getString(body.projectId),
          metadata: asObject(body.metadata),
          state: (asObject(body.state) ?? {}) as JsonObject,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: [],
          items: [],
          messages: {
            ui: [],
            llm: []
          }
        };

        await stores.session.set(record.id, record);
        return jsonResponse(201, {
          session: record
        });
      }

      if (route.kind === "delete_session") {
        const existing = await stores.session.get(route.sessionId);
        if (existing === undefined) {
          return jsonResponse(404, {
            error: `Unknown session "${route.sessionId}"`
          });
        }

        await stores.session.delete(route.sessionId);
        return emptyResponse(204);
      }

      if (route.kind === "user_stream") {
        return jsonResponse(501, {
          error: "User stream is not enabled in Phase 1"
        });
      }

      return jsonResponse(404, {
        error: "Route not found"
      });
    } catch (error) {
      const normalized = normalizeError(error);
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
