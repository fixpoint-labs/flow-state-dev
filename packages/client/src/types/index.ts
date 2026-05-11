/**
 * Public client transport and API contracts shared by client and react wrappers.
 */
import type {
  ContentPartAddedEvent,
  ContentPartDeltaEvent,
  ContentPartDoneEvent,
  ItemAddedEvent,
  ItemDoneEvent,
  ItemUpdatedEvent,
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
};

/**
 * One inlined item inside `CollectionSnapshotEntry.prefetched`.
 *
 * `clientData` is present only when the collection sets `client.state.read: true`;
 * otherwise the entry carries just the `topic`. `content` is present only when
 * `client.content.prefetch: true` is also declared.
 */
export type CollectionSnapshotPrefetchedItem = {
  topic: string;
  clientData?: unknown;
  content?: string;
};

/**
 * Client-visible metadata for a collection resource in the snapshot.
 *
 * As of FIX-427 the per-item `items` map is no longer materialized by default.
 * `count` is always emitted for client-visible collections; `prefetched` is
 * populated only when the collection declares a non-zero `prefetchWindow`.
 */
export type CollectionSnapshotEntry = {
  /**
   * Total number of items currently in the collection. Always emitted for
   * client-visible collections, regardless of `client.state.read`.
   */
  count?: number;
  /**
   * First N items in lexicographic storage-key order. Populated only when the
   * collection declares `prefetchWindow: N` (N > 0). Per-item `clientData` is
   * included only when `client.state.read: true`.
   */
  prefetched?: CollectionSnapshotPrefetchedItem[];
};

/**
 * One page of collection state returned by `GET /sessions/:id/resources/:ref`.
 */
export type CollectionListPage = {
  items: Array<{ topic: string; clientData?: unknown }>;
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextOffset: number;
  };
};

/**
 * Single collection item state returned by `GET /sessions/:id/resources/:ref/:topic`.
 */
export type CollectionItemState = {
  topic: string;
  clientData?: unknown;
};

/**
 * React-layer wrapper around a collection item. Augments the server's
 * `{ topic, clientData? }` payload with the FIX-296 lazy-content ergonomic
 * (`fetchContent()`) so consumers don't have to plumb the client themselves.
 */
export type CollectionItemHandle = {
  topic: string;
  clientData?: unknown;
  fetchContent(): Promise<string | null>;
};

/**
 * Per-resource manifest entry. Static metadata describing a public resource
 * exposed by a flow.
 */
export type ResourceManifestEntry = {
  ref: string;
  kind: "single" | "collection";
  scope: "session" | "user" | "org";
  /** Pattern (collections only). */
  pattern?: string;
  /** Configured prefetch window (collections only). 0 if unset. */
  prefetchWindow?: number;
  /** Whether the resource declares a `clientData` projection function. */
  hasClientData: boolean;
  client: {
    content?: {
      read?: boolean;
      prefetch?: boolean;
      create?: boolean;
      update?: boolean;
      delete?: boolean;
    };
    state?: {
      read?: boolean;
    };
  };
};

/**
 * Resource manifest returned by `GET /sessions/:id/manifest`. Describes every
 * public resource the session's flow exposes — static per `flowKind`.
 */
export type ResourceManifest = {
  flowKind: string;
  resources: ResourceManifestEntry[];
};

/**
 * Canonical session state snapshot response shape.
 */
export type SessionStateSnapshotResponse = {
  sessionId: string;
  flowKind: string;
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
  /**
   * Fired when an `item.updated` event arrives. The patch is a shallow
   * top-level merge into the previously-added item; identity-invariant
   * keys (`id`, `type`, `provenance`, `agentType`, `transient`) are
   * stripped server-side and should also be ignored defensively here.
   */
  onItemUpdated?: (event: ItemUpdatedEvent) => void;
  onContentAdded?: (event: ContentPartAddedEvent) => void;
  onContentDelta?: (event: ContentPartDeltaEvent) => void;
  onContentDone?: (event: ContentPartDoneEvent) => void;
  onResourceChanged?: (event: RequestResourceChangedEvent) => void;
  onSessionMetadataChanged?: (event: SessionMetadataChangedEvent) => void;
  onDebug?: (event: RequestDebugEvent) => void;
  onEvent?: (event: RequestStreamEvent) => void;
  onError?: (error: Error) => void;
  /**
   * Fired when the parser sees an SSE comment frame (`: ping\n\n`). The
   * server emits these on a fixed cadence so clients can run an inactivity
   * watchdog without producing false positives during long pauses (e.g.
   * an LLM thinking between tokens).
   */
  onHeartbeat?: () => void;
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
