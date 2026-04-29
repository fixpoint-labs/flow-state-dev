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
  ResourceContentCreatedEvent,
  ResourceContentDeletedEvent,
  ResourceContentUpdatedEvent,
  ScopeStateChangedEvent,
  SessionMetadataChangedEvent,
  UserDebugEvent,
  UserResourceChangedEvent,
  UserStreamEvent
} from "@flow-state-dev/core/items";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  ActionConfig,
  ActionInputSchema,
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
  orgId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Canonical action execution response shape.
 */
export type ExecuteActionResponse = {
  status: "in_progress" | "completed" | "failed" | "incomplete";
  request: {
    id: string;
    flowKind: string;
    actionName: string;
    status: "in_progress" | "completed" | "failed" | "incomplete";
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
  requireUser: boolean;
  actions: string[];
  actionSchemas?: Record<string, ActionInputSchema>;
};

export type { ActionInputSchema, ActionFieldSchema, ActionFieldType } from "@flow-state-dev/core/types";

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
  title?: string;
  description?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
};

/**
 * Session detail shape returned from session read/create endpoints.
 */
export type SessionDetail = SessionSummary & {
  orgId?: string;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  version?: number;
  latestRequestId?: string;
  stateSummary?: {
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    org?: Record<string, unknown>;
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
  orgId?: string;
  /**
   * Inbound transport provenance — see server `RequestRecord.source`.
   * Records summarized from a server that pre-dates FIX-438 may omit the
   * field; clients should default missing values to `"http"`.
   */
  source?: string;
  status: RequestStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  items?: OutputItem[];
  createdAt: number;
  updatedAt: number;
};

/**
 * Client-visible metadata for a single resource in the snapshot.
 */
export type ResourceSnapshotEntry = {
  clientData?: unknown;
  /** Only present when `client.content.prefetch: true` is declared on the resource. */
  content?: string;
  /**
   * True when the resource has no `client` config. Only present when the
   * snapshot was requested with `includeInternal: true` (DevTool path);
   * `clientData` then carries the resource's raw state instead of the
   * developer-curated client view.
   */
  internal?: boolean;
};

/**
 * Client-visible metadata for a collection resource in the snapshot.
 */
export type CollectionSnapshotEntry = {
  items: Record<string, {
    clientData?: unknown;
    /** Only present when `client.content.prefetch: true` is declared on the collection. */
    content?: string;
  }>;
  /**
   * True when the collection has no `client` config. See `ResourceSnapshotEntry.internal`.
   */
  internal?: boolean;
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
    org?: Record<string, unknown>;
  };
  clientData: {
    session?: Record<string, unknown>;
    user?: Record<string, unknown>;
    org?: Record<string, unknown>;
  };
  resources?: {
    session?: Record<string, ResourceSnapshotEntry | CollectionSnapshotEntry>;
    user?: Record<string, ResourceSnapshotEntry | CollectionSnapshotEntry>;
    org?: Record<string, ResourceSnapshotEntry | CollectionSnapshotEntry>;
  };
  items?: OutputItem[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextOffset: number;
  };
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
  org?: unknown;
};

/**
 * Optional execution options for action calls.
 */
export type SendActionOptions = {
  sessionId?: string;
  requestId?: string;
  orgId?: string;
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
  org: InferScopeStateFromConfig<TFlow["org"]>;
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
  /** Signal the server to abort an in-progress request. */
  abortRequest: (requestId: string) => Promise<void>;
  actions: TypedActionMethods<TFlow>;
  state: {
    getSnapshot: (sessionId: string) => Promise<SessionStateSnapshotResponse>;
    getSessionState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["session"] | undefined>;
    getUserState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["user"] | undefined>;
    getOrgState: (
      sessionId: string
    ) => Promise<FlowStateMap<TFlow>["org"] | undefined>;
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
  onSessionMetadataChanged?: (event: SessionMetadataChangedEvent) => void;
  onDebug?: (event: RequestDebugEvent) => void;
  onEvent?: (event: RequestStreamEvent) => void;
  onError?: (error: Error) => void;
};

/**
 * Callback set for optional user-stream SSE events.
 */
export type UserSSECallbacks = {
  onResourceChanged?: (event: UserResourceChangedEvent) => void;
  onResourceContentUpdated?: (event: ResourceContentUpdatedEvent) => void;
  onResourceContentCreated?: (event: ResourceContentCreatedEvent) => void;
  onResourceContentDeleted?: (event: ResourceContentDeletedEvent) => void;
  onScopeStateChanged?: (event: ScopeStateChangedEvent) => void;
  onDebug?: (event: UserDebugEvent) => void;
  onEvent?: (event: UserStreamEvent) => void;
  onError?: (error: Error) => void;
};
