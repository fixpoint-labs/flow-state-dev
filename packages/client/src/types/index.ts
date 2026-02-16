/**
 * Public client transport and API contracts shared by client and react wrappers.
 */
import type {
  ContentPartAddedEvent,
  ContentPartDeltaEvent,
  ContentPartDoneEvent,
  ItemAddedEvent,
  ItemDoneEvent,
  RequestCreatedEvent,
  RequestDebugEvent,
  RequestResourceChangedEvent,
  RequestStatus,
  RequestStatusEvent,
  RequestStreamEvent,
  ScopeStateChangedEvent,
  UserDebugEvent,
  UserResourceChangedEvent,
  UserStreamEvent
} from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  FlowActionInput,
  InferScopeStateFromConfig
} from "@flow-state-dev/core/types";

/**
 * Generic fetch signature used by all client transport modules.
 */
export type ClientFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Primitive query parameter value used when building request URLs.
 */
export type QueryValue = string | number | boolean | undefined;

/**
 * Shared transport options for HTTP/SSE clients.
 */
export type ClientTransportOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Error type thrown for non-2xx HTTP responses.
 */
export class ClientHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, options: { status: number; body: unknown }) {
    super(message);
    this.name = "ClientHttpError";
    this.status = options.status;
    this.body = options.body;
  }
}

/**
 * Canonical request body for executing an action.
 */
export type ExecuteActionRequestBody = {
  input: unknown;
  userId: string;
  sessionId?: string;
  requestId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Canonical action execution response shape.
 */
export type ExecuteActionResponse = {
  status: "completed" | "failed" | "incomplete";
  request: {
    id: string;
    flowKind: string;
    actionName: string;
    status: "completed" | "failed" | "incomplete";
  };
  session?: {
    id: string;
  };
  error?: string;
};

/**
 * List-flows API item shape.
 */
export type FlowListEntry = {
  id: string;
  kind: string;
  requireSession: boolean;
  requireUser: boolean;
  actions: string[];
};

/**
 * Capability flags advertised by the server.
 */
export type FlowCapabilities = {
  userStream: boolean;
};

/**
 * Session summary shape used in list endpoints.
 */
export type SessionSummary = {
  id: string;
  flowKind: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Session detail shape returned from session read/create endpoints.
 */
export type SessionDetail = SessionSummary & {
  projectId?: string;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  version?: number;
  latestRequestId?: string;
  stateSummary?: {
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
};

/**
 * Request record fields consumed by client/session views.
 */
export type SessionRequestSummary = {
  id: string;
  flowKind: string;
  actionName: string;
  userId: string;
  sessionId?: string;
  projectId?: string;
  status: RequestStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

/**
 * Canonical session state snapshot response shape.
 */
export type SessionStateSnapshotResponse = {
  sessionId: string;
  flowKind: string;
  state: {
    request?: Record<string, unknown>;
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    project?: Record<string, unknown>;
  };
  resources: Array<{
    scope: "session" | "user" | "project";
    name: string;
    state: Record<string, unknown>;
  }>;
  projections: Record<string, unknown>;
};

/**
 * A minimal structural type accepted by the typed flow client helper.
 */
export type FlowLike = {
  kind: string;
  actions: Record<string, ActionConfig>;
  request?: unknown;
  session?: unknown;
  user?: unknown;
  project?: unknown;
};

/**
 * Optional execution options for action calls.
 */
export type SendActionOptions = {
  sessionId?: string;
  requestId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Typed action-method map derived from a flow's action definitions.
 */
export type TypedActionMethods<TFlow extends FlowLike> = {
  [TAction in keyof TFlow["actions"] & string]: (
    input: FlowActionInput<TFlow["actions"][TAction]>,
    options?: SendActionOptions
  ) => Promise<ExecuteActionResponse>;
};

type FlowStateMap<TFlow extends FlowLike> = {
  request: InferScopeStateFromConfig<TFlow["request"]>;
  session: InferScopeStateFromConfig<TFlow["session"]>;
  user: InferScopeStateFromConfig<TFlow["user"]>;
  project: InferScopeStateFromConfig<TFlow["project"]>;
};

/**
 * Typed flow-bound client surface layered over generic action/session APIs.
 */
export type FlowClient<TFlow extends FlowLike> = {
  flowKind: string;
  userId: string;
  sendAction: (
    action: string,
    input: unknown,
    options?: SendActionOptions
  ) => Promise<ExecuteActionResponse>;
  actions: TypedActionMethods<TFlow>;
  state: {
    getSnapshot: (sessionId: string) => Promise<SessionStateSnapshotResponse>;
    getSessionState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["session"] | undefined>;
    getUserState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["user"] | undefined>;
    getProjectState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["project"] | undefined>;
  };
};

/**
 * Handle returned by request-stream SSE connections.
 */
export interface RequestStreamHandle {
  close(): void;
  readonly lastEventId?: string;
}

/**
 * Handle returned by optional user-stream SSE connections.
 */
export interface UserStreamHandle {
  close(): void;
  readonly lastEventId?: string;
}

/**
 * Callback set for request-stream SSE events.
 */
export type RequestSSECallbacks = {
  onRequestCreated?: (event: RequestCreatedEvent) => void;
  onRequestStatus?: (event: RequestStatusEvent) => void;
  onItemAdded?: (event: ItemAddedEvent) => void;
  onItemDone?: (event: ItemDoneEvent) => void;
  onContentAdded?: (event: ContentPartAddedEvent) => void;
  onContentDelta?: (event: ContentPartDeltaEvent) => void;
  onContentDone?: (event: ContentPartDoneEvent) => void;
  onResourceChanged?: (event: RequestResourceChangedEvent) => void;
  onDebug?: (event: RequestDebugEvent) => void;
  onEvent?: (event: RequestStreamEvent) => void;
  onError?: (error: Error) => void;
};

/**
 * Callback set for optional user-stream SSE events.
 */
export type UserSSECallbacks = {
  onResourceChanged?: (event: UserResourceChangedEvent) => void;
  onScopeStateChanged?: (event: ScopeStateChangedEvent) => void;
  onDebug?: (event: UserDebugEvent) => void;
  onEvent?: (event: UserStreamEvent) => void;
  onError?: (error: Error) => void;
};
