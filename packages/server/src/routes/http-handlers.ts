/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 */
import type {
  OutputItem,
  RequestStatusEvent,
  RequestStreamEvent
} from "@flow-state-dev/core/items";
import type {
  JsonObject,
  ModelResolver,
  ResourceConfig,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import { FlowError, ValidationError } from "../errors/flow-error";
import { runAction } from "../execution/runAction";
import { type FlowRegistry } from "../registry/flow-registry";
import { createInMemoryStores } from "../stores";
import type {
  RequestRecord,
  SessionRecord,
  StoreRegistry
} from "../stores/types";
import {
  canRegisterStream,
  cleanupStaleStreams,
  configureActiveStreamRegistry,
  getActiveStream,
  registerStream,
  removeStream
} from "../streaming/active-streams";
import { encodeStreamEvent } from "../streaming/encode-event";
import { createLiveRequestStream } from "../streaming/live-stream";
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
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  maxResponseBufferSize?: number;
  maxConcurrentStreams?: number;
  staleStreamTtlMs?: number;
  onError?: (error: Error, context: { method: string; path: string }) => void;
  internalSeams?: InternalRouteSeams;
};

const DEFAULT_STATE_ITEMS_LIMIT = 100;

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

function getBooleanFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

type ClientDataScope = "session" | "user" | "project";
type ClientDataFilter = Partial<Record<ClientDataScope, Set<string>>>;

function parseClientDataFilter(value: string | null): ClientDataFilter | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed: ClientDataFilter = {};
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [scopeCandidate, dataName] = entry.split(".", 2);
    const isScoped =
      scopeCandidate === "session" ||
      scopeCandidate === "user" ||
      scopeCandidate === "project";
    const scope: ClientDataScope = isScoped ? scopeCandidate : "session";
    const name = isScoped ? dataName : scopeCandidate;

    if (name === undefined || name.trim().length === 0) {
      continue;
    }

    if (parsed[scope] === undefined) {
      parsed[scope] = new Set<string>();
    }

    parsed[scope]!.add(name.trim());
  }

  if (Object.keys(parsed).length === 0) {
    return undefined;
  }

  return parsed;
}

function shouldIncludeClientData(
  filter: ClientDataFilter | undefined,
  scope: ClientDataScope,
  name: string
): boolean {
  if (filter === undefined) {
    return true;
  }

  const values = filter[scope];
  if (values === undefined) {
    return false;
  }

  return values.has(name);
}

function cloneValue<TValue>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function isResourceConfig(value: unknown): value is ResourceConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { stateSchema?: { safeParse?: unknown } };
  return (
    typeof candidate.stateSchema === "object" &&
    candidate.stateSchema !== null &&
    typeof candidate.stateSchema.safeParse === "function"
  );
}

function normalizeResourceDefault(config: ResourceConfig): JsonObject {
  if (config.default !== undefined && isJsonObject(config.default)) {
    return cloneValue(config.default);
  }

  const parsedUndefined = config.stateSchema.safeParse(undefined);
  if (parsedUndefined.success && isJsonObject(parsedUndefined.data)) {
    return asJsonObject(parsedUndefined.data);
  }

  const parsedEmpty = config.stateSchema.safeParse({});
  if (parsedEmpty.success && isJsonObject(parsedEmpty.data)) {
    return asJsonObject(parsedEmpty.data);
  }

  return {};
}

function normalizeResourceState(config: ResourceConfig, value: unknown): JsonObject {
  const parsed = config.stateSchema.safeParse(value);
  if (parsed.success && isJsonObject(parsed.data)) {
    return asJsonObject(parsed.data);
  }

  return normalizeResourceDefault(config);
}

function createScopeResources(options: {
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
}): Record<string, Record<string, unknown>> {
  const handles: Record<string, Record<string, unknown>> = {};

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
    if (!isResourceConfig(maybeConfig)) {
      continue;
    }

    const readState = (): JsonObject =>
      cloneValue(
        normalizeResourceState(
          maybeConfig,
          options.persisted?.[resourceName]
        )
      );

    handles[resourceName] = {
      name: resourceName,
      config: maybeConfig,
      get state() {
        return readState();
      }
    };
  }

  return handles;
}

async function computeClientData(options: {
  definitions: Record<string, unknown> | undefined;
  scope: ClientDataScope;
  filter: ClientDataFilter | undefined;
  state: JsonObject;
  resources: Record<string, Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  for (const [name, compute] of Object.entries(options.definitions ?? {})) {
    if (typeof compute !== "function") {
      continue;
    }

    if (!shouldIncludeClientData(options.filter, options.scope, name)) {
      continue;
    }

    out[name] = await (
      compute as (ctx: { state: JsonObject; resources: Record<string, unknown> }) => unknown
    )({
      state: options.state,
      resources: options.resources
    });
  }

  return out;
}

function sortItems(items: OutputItem[] | undefined): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  // Items are aggregated across multiple requests. Each request assigns
  // itemIndex starting from 0, so itemIndex alone is not globally unique.
  // Sort primarily by timestamp (chronological across requests), then by
  // itemIndex as a tiebreaker within the same request.
  return [...items].sort((left, right) => {
    const tsDiff = left.ts - right.ts;
    if (tsDiff !== 0) {
      return tsDiff;
    }

    return left.itemIndex - right.itemIndex;
  });
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

  const events: RequestStreamEvent[] = [
    {
      stream: "request",
      type: "request.created",
      requestId: record.id,
      sequence_number: 1,
      status: "in_progress",
      ts: createdAt
    }
  ];

  let seq = 2;
  if (record.items !== undefined) {
    for (const item of record.items) {
      events.push({
        stream: "request",
        type: "item.added",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
      events.push({
        stream: "request",
        type: "item.done",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
    }
  }

  events.push({
    stream: "request",
    type: requestStatusEventType(record.status),
    requestId: record.id,
    sequence_number: seq,
    status: record.status,
    ts: statusTs
  });

  return events;
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
  configureActiveStreamRegistry({
    maxConcurrentStreams: options.maxConcurrentStreams,
    staleStreamTtlMs: options.staleStreamTtlMs,
    onWarning: (message, detail) => {
      console.warn(`[flow-state] ${message}`, detail);
    }
  });
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

        // Create a LiveRequestStream synchronously before async execution.
        // This ensures the SSE endpoint can find the stream when the client connects.
        const liveStream = createLiveRequestStream({
          requestId: resolvedActionInput.requestId,
          maxBufferSize: options.maxResponseBufferSize
        });

        if (!canRegisterStream()) {
          return jsonResponse(503, {
            error: "Server is at active stream capacity. Retry shortly."
          });
        }

        registerStream(resolvedActionInput.requestId, liveStream);

        // Fire-and-forget: start execution without awaiting.
        // The stream delivers events to the SSE client in real-time.
        void runAction({
          flow,
          actionName: resolvedActionInput.actionName as keyof typeof flow.actions & string,
          input: resolvedActionInput.input,
          userId: resolvedActionInput.userId,
          sessionId: resolvedActionInput.sessionId,
          requestId: resolvedActionInput.requestId,
          projectId: resolvedActionInput.projectId,
          metadata: resolvedActionInput.metadata,
          signal: resolvedActionInput.signal,
          modelResolver: options.modelResolver,
          speechResolver: options.speechResolver,
          stores,
          responseEmitter: liveStream.emitter
        }).finally(() => {
          liveStream.close();
          removeStream(resolvedActionInput.requestId);
        });

        return jsonResponse(202, {
          status: "in_progress",
          request: {
            id: resolvedActionInput.requestId,
            flowKind: flow.kind,
            actionName: resolvedActionInput.actionName,
            status: "in_progress"
          },
          session:
            resolvedActionInput.sessionId === undefined
              ? undefined
              : {
                  id: resolvedActionInput.sessionId
                }
        });
      }

      if (route.kind === "request_stream") {
        cleanupStaleStreams();
        const flow = options.registry.get(route.flowKind);
        if (flow === undefined) {
          return jsonResponse(404, {
            error: `Unknown flow "${route.flowKind}"`
          });
        }

        // Check for a live (in-flight) stream first — delivers events in real-time.
        const activeStream = getActiveStream(route.requestId);
        if (activeStream !== undefined) {
          return new Response(activeStream.readable, {
            status: 200,
            headers: SSE_HEADERS
          });
        }

        // No active stream — request already completed. Fall back to replay
        // from persisted RequestRecord events.
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

        const flow = options.registry.get(session.flowKind);
        if (flow === undefined) {
          return jsonResponse(404, {
            error: `Unknown flow "${session.flowKind}"`
          });
        }

        const url = new URL(request.url);
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

        // Items are canonical on RequestRecords — aggregate from all session
        // requests when the client asks for items (architecture: "session
        // history is derived by iterating request items across session requests").
        let aggregatedItems: OutputItem[] | undefined;
        let totalItems = 0;
        if (includeItems) {
          const requests = await stores.request.list({
            sessionId: session.id
          });
          aggregatedItems = [];
          for (const req of requests) {
            if (req.items !== undefined) {
              for (const item of req.items) {
                if (itemTypeFilter === undefined || itemTypeFilter.has(item.type)) {
                  aggregatedItems.push(item);
                }
              }
            }
          }

          aggregatedItems = sortItems(aggregatedItems);
          totalItems = aggregatedItems.length;
          aggregatedItems = aggregatedItems.slice(offset, offset + limit);
        }
        const sessionResources = createScopeResources({
          configs: flow.session?.resources as Record<string, unknown> | undefined,
          persisted: session.resources as Record<string, unknown> | undefined
        });
        const userResources = createScopeResources({
          configs: flow.user?.resources as Record<string, unknown> | undefined,
          persisted: user?.resources as Record<string, unknown> | undefined
        });
        const projectResources = createScopeResources({
          configs: flow.project?.resources as Record<string, unknown> | undefined,
          persisted: project?.resources as Record<string, unknown> | undefined
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
          journal: []
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

      if (route.kind === "transcribe") {
        if (options.transcriptionResolver === undefined) {
          return jsonResponse(501, {
            error: "Transcription is not configured on this server"
          });
        }

        // 25 MB matches OpenAI Whisper's upload limit.
        const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

        const contentType = request.headers.get("content-type") ?? "";
        let audioData: Uint8Array;
        let mediaType: string;
        let language: string | undefined;

        if (contentType.includes("application/json")) {
          const body = await parseJsonBody(request);
          const userId = getString(body.userId as string | undefined);
          if (userId === undefined) {
            return jsonResponse(400, {
              error: "Transcription requires non-empty userId"
            });
          }
          const audioBase64 = getString(body.audio as string | undefined);
          if (audioBase64 === undefined) {
            return jsonResponse(400, {
              error: "Transcription requires audio data (base64 in 'audio' field)"
            });
          }
          audioData = new Uint8Array(Buffer.from(audioBase64, "base64"));
          if (audioData.byteLength === 0) {
            return jsonResponse(400, {
              error: "Transcription requires non-empty audio data"
            });
          }
          if (audioData.byteLength > MAX_AUDIO_BYTES) {
            return jsonResponse(413, {
              error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
            });
          }
          mediaType = getString(body.mediaType as string | undefined) ?? "audio/webm";
          language = getString(body.language as string | undefined);
        } else {
          const url = new URL(request.url);
          const userId = getString(url.searchParams.get("userId"));
          if (userId === undefined) {
            return jsonResponse(400, {
              error: "Transcription requires non-empty userId query parameter"
            });
          }

          // Check content-length header before reading the body to reject
          // oversized payloads without buffering them into memory.
          const contentLength = request.headers.get("content-length");
          if (contentLength !== null) {
            const size = parseInt(contentLength, 10);
            if (!Number.isNaN(size) && size > MAX_AUDIO_BYTES) {
              return jsonResponse(413, {
                error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
              });
            }
          }

          const buffer = await request.arrayBuffer();
          if (buffer.byteLength === 0) {
            return jsonResponse(400, {
              error: "Transcription requires audio data in request body"
            });
          }
          if (buffer.byteLength > MAX_AUDIO_BYTES) {
            return jsonResponse(413, {
              error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
            });
          }
          audioData = new Uint8Array(buffer);
          mediaType = contentType.split(";")[0].trim() || "audio/webm";
          language = getString(url.searchParams.get("language"));
        }

        const model = options.transcriptionResolver("gpt-4o-mini-transcribe");
        const result = await model.transcribe({
          audio: audioData,
          mediaType,
          language
        });

        return jsonResponse(200, {
          text: result.text,
          language: result.language
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
