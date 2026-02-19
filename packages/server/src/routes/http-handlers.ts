/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 */
import type {
  OutputItem,
  RequestStatusEvent,
  RequestStreamEvent
} from "@flow-state-dev/core/items";
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
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

function getBooleanFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

type ProjectionScope = "session" | "user" | "project";
type ProjectionFilter = Partial<Record<ProjectionScope, Set<string>>>;

function parseProjectionFilter(value: string | null): ProjectionFilter | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed: ProjectionFilter = {};
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [scopeCandidate, projectionName] = entry.split(".", 2);
    const isScoped =
      scopeCandidate === "session" ||
      scopeCandidate === "user" ||
      scopeCandidate === "project";
    const scope: ProjectionScope = isScoped ? scopeCandidate : "session";
    const name = isScoped ? projectionName : scopeCandidate;

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

function shouldIncludeProjection(
  filter: ProjectionFilter | undefined,
  scope: ProjectionScope,
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

function createNoopScopeOps(): {
  patchState: (...args: unknown[]) => Promise<void>;
  setState: (...args: unknown[]) => Promise<void>;
  incState: (...args: unknown[]) => Promise<void>;
  pushState: (...args: unknown[]) => Promise<void>;
  setStateRecord: (...args: unknown[]) => Promise<void>;
  deleteStateRecord: (...args: unknown[]) => Promise<void>;
  atomicState: (...args: unknown[]) => Promise<void>;
} {
  const noop = async (): Promise<void> => undefined;
  return {
    patchState: noop,
    setState: noop,
    incState: noop,
    pushState: noop,
    setStateRecord: noop,
    deleteStateRecord: noop,
    atomicState: noop
  };
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

function createProjectionResources(options: {
  scope: "session" | "user" | "project";
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
}): Record<string, unknown> {
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
      scope: options.scope,
      config: maybeConfig,
      get state() {
        return readState();
      },
      patchState: async () => {
        throw new Error(`Projection resources are read-only ("${resourceName}")`);
      },
      setState: async () => {
        throw new Error(`Projection resources are read-only ("${resourceName}")`);
      },
      updateState: async () => {
        throw new Error(`Projection resources are read-only ("${resourceName}")`);
      },
      readContent: async () => {
        const state = readState();
        const content = state.content;
        return typeof content === "string" ? content : JSON.stringify(state);
      },
      writeContent: async () => {
        throw new Error(`Projection resources are read-only ("${resourceName}")`);
      }
    };
  }

  return {
    ...handles,
    get: (name: string) => {
      const handle = handles[name];
      if (handle === undefined) {
        throw new Error(`Resource "${name}" is not registered`);
      }

      return handle;
    },
    list: () => Object.values(handles)
  };
}

function createRequestProjectionHandle(options: {
  requestId: string;
  userId: string;
  projectId?: string;
  state?: JsonObject;
}): Record<string, unknown> {
  return {
    identity: {
      type: "request",
      id: options.requestId,
      userId: options.userId,
      projectId: options.projectId
    },
    state: options.state ?? {},
    ...createNoopScopeOps()
  };
}

function createSessionProjectionHandle(options: {
  sessionId: string;
  userId: string;
  projectId?: string;
  state?: JsonObject;
  resources?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    identity: {
      type: "session",
      id: options.sessionId,
      userId: options.userId,
      projectId: options.projectId
    },
    state: options.state ?? {},
    resources: options.resources ?? {
      get: () => {
        throw new Error("Resource registry unavailable");
      },
      list: () => []
    },
    ...createNoopScopeOps()
  };
}

function createUserProjectionHandle(options: {
  userId: string;
  state?: JsonObject;
  resources?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    identity: {
      type: "user",
      id: options.userId,
      userId: options.userId
    },
    state: options.state ?? {},
    resources: options.resources ?? {
      get: () => {
        throw new Error("Resource registry unavailable");
      },
      list: () => []
    },
    ...createNoopScopeOps()
  };
}

function createProjectProjectionHandle(options: {
  projectId: string;
  userId?: string;
  state?: JsonObject;
  resources?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    identity: {
      type: "project",
      id: options.projectId,
      userId: options.userId,
      projectId: options.projectId
    },
    state: options.state ?? {},
    resources: options.resources ?? {
      get: () => {
        throw new Error("Resource registry unavailable");
      },
      list: () => []
    },
    ...createNoopScopeOps()
  };
}

function resolveProjectionCompute(
  definition: unknown
): ((ctx: Record<string, unknown>) => unknown | Promise<unknown>) | undefined {
  if (typeof definition === "function") {
    return definition as (ctx: Record<string, unknown>) => unknown | Promise<unknown>;
  }

  if (
    typeof definition === "object" &&
    definition !== null &&
    "compute" in definition &&
    typeof (definition as { compute?: unknown }).compute === "function"
  ) {
    return (definition as { compute: (ctx: Record<string, unknown>) => unknown | Promise<unknown> })
      .compute;
  }

  return undefined;
}

function isClientProjection(definition: unknown): boolean {
  if (typeof definition === "function") {
    return true;
  }

  if (typeof definition !== "object" || definition === null) {
    return false;
  }

  return (definition as { client?: unknown }).client === true;
}

function applyProjectionOutputSchema(
  definition: unknown,
  value: unknown
): unknown {
  if (typeof definition !== "object" || definition === null) {
    return value;
  }

  const schema = (definition as { outputSchema?: { parse?: unknown } }).outputSchema;
  if (
    schema === undefined ||
    typeof schema !== "object" ||
    schema === null ||
    typeof (schema as { parse?: unknown }).parse !== "function"
  ) {
    return value;
  }

  return (schema as { parse: (input: unknown) => unknown }).parse(value);
}

async function computeScopeProjections(options: {
  definitions: Record<string, unknown> | undefined;
  scope: ProjectionScope;
  filter: ProjectionFilter | undefined;
  context: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(options.definitions ?? {})) {
    if (!isClientProjection(definition)) {
      continue;
    }

    if (!shouldIncludeProjection(options.filter, options.scope, name)) {
      continue;
    }

    const compute = resolveProjectionCompute(definition);
    if (compute === undefined) {
      continue;
    }

    const value = await compute(options.context);
    out[name] = applyProjectionOutputSchema(definition, value);
  }

  return out;
}

function sortItems(items: OutputItem[] | undefined): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...items].sort((left, right) => left.itemIndex - right.itemIndex);
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
        const projectionFilter = parseProjectionFilter(
          url.searchParams.get("projections")
        );
        const includeItems = getBooleanFlag(
          url.searchParams.get("include_items")
        );
        const sessionResources = createProjectionResources({
          scope: "session",
          configs: flow.session?.resources as Record<string, unknown> | undefined,
          persisted: session.resources as Record<string, unknown> | undefined
        });
        const userResources = createProjectionResources({
          scope: "user",
          configs: flow.user?.resources as Record<string, unknown> | undefined,
          persisted: user?.resources as Record<string, unknown> | undefined
        });
        const projectResources = createProjectionResources({
          scope: "project",
          configs: flow.project?.resources as Record<string, unknown> | undefined,
          persisted: project?.resources as Record<string, unknown> | undefined
        });

        const projectionContext: Record<string, unknown> = {
          request: createRequestProjectionHandle({
            requestId: latestRequest?.id ?? `request_for_${session.id}`,
            userId: session.userId,
            projectId: session.projectId,
            state: latestRequest?.state
          }),
          session: {
            ...createSessionProjectionHandle({
              sessionId: session.id,
              userId: session.userId,
              projectId: session.projectId,
              state: session.state,
              resources: sessionResources
            })
          },
          user:
            user === undefined
              ? null
              : createUserProjectionHandle({
                  userId: user.userId,
                  state: user.state,
                  resources: userResources
                }),
          project:
            project === undefined
              ? null
              : createProjectProjectionHandle({
                  projectId: project.projectId,
                  userId: project.userId,
                  state: project.state,
                  resources: projectResources
                })
        };

        const sessionProjections = await computeScopeProjections({
          definitions: flow.session?.projections as Record<string, unknown> | undefined,
          scope: "session",
          filter: projectionFilter,
          context: projectionContext
        });
        const userProjections = await computeScopeProjections({
          definitions: flow.user?.projections as Record<string, unknown> | undefined,
          scope: "user",
          filter: projectionFilter,
          context: projectionContext
        });
        const projectProjections = await computeScopeProjections({
          definitions: flow.project?.projections as Record<string, unknown> | undefined,
          scope: "project",
          filter: projectionFilter,
          context: projectionContext
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
          projections: {
            session:
              Object.keys(sessionProjections).length > 0
                ? sessionProjections
                : undefined,
            user:
              Object.keys(userProjections).length > 0
                ? userProjections
                : undefined,
            project:
              Object.keys(projectProjections).length > 0
                ? projectProjections
                : undefined
          },
          items: includeItems
            ? sortItems(session.items as unknown as OutputItem[])
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
