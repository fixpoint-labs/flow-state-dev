import type {
  JournalEntry,
  RequestStatus,
  SequencerCheckpoint
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  BlockTraceItem,
  OutputItem,
  RequestStreamEvent,
  RouterDecisionItem,
  StateSnapshotItem
} from "@flow-state-dev/core/items";

export type { RequestStatus };

export type ScopeRecordBase<TState extends JsonObject = JsonObject> = {
  id: string;
  state: TState;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type SessionRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  flowKind: string;
  userId: string;
  orgId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  resources?: Record<string, JsonObject>;
  metadata?: Record<string, unknown>;
  latestRequestId?: string;
  journal: JournalEntry[];
};

export type RequestRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  flowKind: string;
  actionName: string;
  userId: string;
  sessionId?: string;
  orgId?: string;
  /**
   * Provenance of the inbound transport that produced this request.
   * Set from `InboundRequestEnvelope.source` (FIX-438). Open string —
   * documented known-set: `http` | `mcp` | `webhook` | `scheduled` |
   * `notification`. Reads of records persisted before this field existed
   * default to `"http"` in the store implementations.
   */
  source: string;
  status: RequestStatus;
  startedAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
  input?: unknown;
  items?: OutputItem[];
  interruptedAt?: number;
  abortRequested?: boolean;
  abortedAt?: number;
};

export type UserRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  userId: string;
  resources?: Record<string, JsonObject>;
};

export type OrgRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  orgId: string;
  userId?: string;
  resources?: Record<string, JsonObject>;
};

export type SessionListOptions = {
  flowKind?: string;
  userId?: string;
  limit?: number;
  offset?: number;
};

export type RequestListOptions = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  status?: RequestStatus;
  limit?: number;
  offset?: number;
};

export type UserListOptions = {
  limit?: number;
  offset?: number;
};

export type OrgListOptions = {
  userId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Indicates the expected pre-update version for a CAS write.
 * - A number means "only write if the current stored version equals this"
 * - "any" means "write unconditionally" (used for creates, migrations, and
 *   system writes that fall outside the CAS retry loop)
 */
export type ExpectedVersion = number | "any";

/**
 * Outcome of a CAS-aware `Store.set`. Encodes conflict as data rather than
 * throwing so retry loops stay on the hot path. On conflict the store returns
 * the current value and version so the caller can refresh its cache and
 * re-apply the mutator.
 */
export type SetResult<TRecord> =
  | { ok: true; version: number }
  | {
      ok: false;
      conflict: { currentValue: TRecord | undefined; currentVersion: number };
    };

/**
 * Optional CAS-aware delta verbs adapters may implement to avoid full-record
 * UPDATEs on single-field scope-state writes. All verbs target the record's
 * `state` slice — `path` is a key sequence (`["count"]`, `["foo", "bar"]`)
 * relative to `state`, not to the record root.
 *
 * Adapters MAY implement none, some, or all of these. The CAS persist
 * callback feature-detects per call and falls back to `set` with the full
 * record when a verb is absent (capability advertisement). Once FIX-85
 * (Upstash) and FIX-83 (Mongo) ship, those adapters implement the verbs as
 * required — the optional-in-v1 stance is a migration concession to existing
 * SQLite and filesystem adapters.
 *
 * Concurrency contract is identical to `set`: the write applies only when
 * the current stored version equals `expectedVersion` (or always when
 * `"any"`). Returns the new version on success, or the current record/
 * version on conflict.
 *
 * `updatedAt` is caller-supplied (matching `set`, where it travels inside
 * the record). Adapters MUST write it as given so the caller's local cache
 * of the record stays consistent with what's persisted.
 */
export interface DeltaStoreOps<TRecord> {
  /**
   * Replace the value at `path` inside the record's `state` slice. Equivalent
   * to a shallow merge of `{ [path[0]]: value }` into `state` for depth-1
   * paths. The remainder of the record (other state fields, metadata,
   * top-level columns) is preserved unchanged.
   */
  patchField?(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;

  /**
   * Atomically add `delta` to the numeric value at `path` inside `state`.
   * Treats a missing or non-numeric value as `0`. Other record fields are
   * preserved unchanged.
   */
  incField?(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;

  /**
   * Append `values` (in order) to the array at `path` inside `state`. Treats
   * a missing value as an empty array; throws via the adapter's normal error
   * surface if the existing value is non-array. Other record fields are
   * preserved unchanged.
   */
  pushToArray?(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;
}

export interface SessionStore extends DeltaStoreOps<SessionRecord> {
  get(id: string): Promise<SessionRecord | undefined>;
  /**
   * Write `value` when the stored record's version matches `expectedVersion`.
   * Returns the new version on success or the current stored value/version on
   * conflict. The `version` field on `value` is the NEW version to persist.
   */
  set(
    id: string,
    value: SessionRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<SessionRecord>>;
  delete(id: string): Promise<void>;
  list(options?: SessionListOptions): Promise<SessionRecord[]>;
}

export interface RequestStore extends DeltaStoreOps<RequestRecord> {
  get(id: string): Promise<RequestRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>>;
  delete(id: string): Promise<void>;
  list(options?: RequestListOptions): Promise<RequestRecord[]>;

  /**
   * Persist the current items for an in-progress request.
   * Non-blocking from the caller's perspective — the backend handles async flushing.
   * Callers should call flushItems() before writing terminal status.
   */
  persistItems(requestId: string, items: OutputItem[]): void;

  /**
   * Wait for all pending item persistence writes to complete.
   * Called before the terminal patchRequestRecord.
   */
  flushItems(requestId: string): Promise<void>;

  /**
   * Persist a stream event for a request.
   * Non-blocking — the backend handles async flushing.
   * Events are stored in sequence order for cursor-based replay.
   */
  persistEvents(requestId: string, events: RequestStreamEvent[]): void;

  /**
   * Wait for all pending event persistence writes to complete.
   * Called before the terminal patchRequestRecord.
   */
  flushEvents(requestId: string): Promise<void>;

  /**
   * Retrieve persisted stream events for a request.
   * Returns events sorted by sequence_number. When `fromSequence` is
   * provided, only events with `sequence_number > fromSequence` are
   * returned; omitting it returns the full log (used by the
   * completed-request replay path).
   */
  getEvents(requestId: string, fromSequence?: number): Promise<RequestStreamEvent[]>;

  /**
   * Yields events for a request as they are persisted. Catch-up replay
   * covers events with `sequence_number > options.fromSequence`; the live
   * phase yields events as they arrive until the iterator aborts, sees a
   * terminal request status, or hits the liveness timeout. The "close"
   * path is `signal.abort()`; there is no separate `.close()` method.
   *
   * Backends without a cross-process push primitive (SQLite, filesystem,
   * Postgres-without-`liveTailPool`) poll. Memory uses an in-process bus
   * shared with the persistence path.
   */
  subscribeToEvents(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent>;

  /**
   * Lookup the memoized result of a `ctx.runOnce(key, fn)` call (FIX-402).
   * Returns `{ found: false }` when no record exists for this `(requestId,
   * key)` pair. The stored value is opaque JSON — the caller is responsible
   * for any type coercion. Implementations should treat misses as cheap
   * and not allocate on miss.
   */
  getRunOnceResult(
    requestId: string,
    key: string
  ): Promise<{ found: boolean; value?: unknown }>;

  /**
   * Persist the result of a `ctx.runOnce(key, fn)` call (FIX-402). The
   * value replaces any prior record for this `(requestId, key)` pair —
   * callers serialize execution per key so a late writer overwriting an
   * earlier success is benign (they computed the same fn).
   */
  setRunOnceResult(
    requestId: string,
    key: string,
    value: unknown
  ): Promise<void>;
}

/**
 * Options for `RequestStore.subscribeToEvents`. `fromSequence` is required
 * — a subscriber that has seen nothing passes `0`. Optionality would
 * invite the bug where a reconnecting client with a stale `Last-Event-ID`
 * accidentally re-receives the entire log.
 */
export interface SubscribeToEventsOptions {
  /** Subscriber's last-seen sequence number; `0` means no events seen. */
  fromSequence: number;
  /** Aborts the subscription cleanly when the SSE client disconnects. */
  signal?: AbortSignal;
  /**
   * If no events arrive in this window AND no terminal status is observed
   * in the store, the iterator yields a synthetic `request.interrupted`
   * event (not persisted) and closes. Default `30000`. Ignored for the
   * in-memory store, where there is no cross-process death scenario.
   */
  livenessTimeoutMs?: number;
  /**
   * Per-subscription bounded queue capacity. On overflow the iterator
   * throws `StoreSubscriptionError("backpressure_overflow")`. Default
   * `1000`.
   */
  maxPendingEvents?: number;
}

export interface UserStore extends DeltaStoreOps<UserRecord> {
  get(id: string): Promise<UserRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: UserRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<UserRecord>>;
  delete(id: string): Promise<void>;
  list(options?: UserListOptions): Promise<UserRecord[]>;
}

export interface OrgStore extends DeltaStoreOps<OrgRecord> {
  get(id: string): Promise<OrgRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: OrgRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<OrgRecord>>;
  delete(id: string): Promise<void>;
  list(options?: OrgListOptions): Promise<OrgRecord[]>;
}

export type ActiveRequestEntry = {
  requestId: string;
  flowKind: string;
  actionName: string;
  sessionId?: string;
  userId: string;
  orgId?: string;
  /** Inbound transport provenance — see `RequestRecord.source`. */
  source: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  startedAt: number;
  lastHeartbeatAt: number;
};

export interface ActiveRequestRegistry {
  /** Register a new in-flight request. Called at the start of runAction. */
  register(entry: ActiveRequestEntry): Promise<void>;

  /** Update the heartbeat timestamp. Called on a periodic interval. */
  heartbeat(requestId: string): Promise<void>;

  /** Remove a request from the registry. Called on terminal (success/failure). */
  deregister(requestId: string): Promise<void>;

  /** Return all entries whose lastHeartbeatAt is older than Date.now() - thresholdMs. */
  listStale(thresholdMs: number): Promise<ActiveRequestEntry[]>;

  /** Return all currently registered entries. */
  listAll(): Promise<ActiveRequestEntry[]>;

  /** Return a single entry by requestId, or undefined. */
  get(requestId: string): Promise<ActiveRequestEntry | undefined>;
}

/**
 * Scope discriminator for content storage.
 * Excludes "request" since request-scoped resources are not supported.
 */
export type ContentScopeType = "session" | "user" | "org";

/**
 * Separates resource content persistence from scope record persistence.
 *
 * Content is addressed by (scopeType, scopeId, resourceKey). This allows
 * adapters to store content independently of metadata — e.g., SQL metadata
 * with blob storage for content, or individual files on the filesystem.
 */
export interface ContentStore {
  /** Read a single resource's content. */
  get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined>;

  /** Write a single resource's content. Creates or overwrites. */
  set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void>;

  /** Delete a single resource's content. */
  delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void>;

  /** Read all content for a scope instance. Used during context initialization and state route reads. */
  getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>>;

  /** Delete all content for a scope instance. Used during scope record deletion. */
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
}

/**
 * Durable sequencer checkpoint store (FIX-401).
 *
 * Latest-only persistence: identity is `(requestId, blockInstanceId)`. Each
 * write overwrites any prior record. The Phase 2 resume runtime (FIX-141)
 * reads the latest checkpoint to find the resume point — no enumeration
 * needed since identity is fully scoped.
 *
 * GC is per-instance: each sequencer's terminal state_snapshot triggers a
 * `delete` for its own instance. No `listForRequest` / `pruneBefore` /
 * `stepHistory` — those are explicitly out of scope (see FIX-401 spec).
 */
export interface CheckpointStore {
  /** Overwrite the latest checkpoint for this sequencer instance. */
  write(checkpoint: SequencerCheckpoint): Promise<void>;

  /** Read the latest checkpoint, or `null` if none exists. */
  latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null>;

  /** Remove the checkpoint when its sequencer reaches terminal state. */
  delete(requestId: string, blockInstanceId: string): Promise<void>;
}

/**
 * A single trace event captured by the runtime. Carries the originating
 * request, a monotonically-increasing per-request `sequenceNumber` for
 * cursor-based reads, the wall-clock timestamp, the event type, and the
 * inner debug item.
 */
export type TraceEvent = {
  requestId: string;
  sequenceNumber: number;
  ts: number;
  type: "trace.item.added" | "trace.item.done";
  item: BlockTraceItem | RouterDecisionItem | StateSnapshotItem;
};

/**
 * Per-request trace event log. Implementations are responsible for bounded
 * retention — callers should not assume unbounded history.
 *
 * `appendEvent` is logically append-only per request. `flush` lets adapters
 * with batched I/O guarantee durability before a read. `getEvents` supports
 * cursor reads via `fromSequence` (exclusive lower bound). `listRequestIds`
 * returns the request IDs currently retained, in insertion order.
 *
 * TODO(FIX-511): cross-process live tail.
 */
export interface TraceStore {
  appendEvent(requestId: string, event: TraceEvent): Promise<void>;
  flush(requestId: string): Promise<void>;
  getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]>;
  listRequestIds(): Promise<string[]>;
}

export type StoreRegistry = {
  session: SessionStore;
  request: RequestStore;
  user: UserStore;
  org: OrgStore;
  activeRequests: ActiveRequestRegistry;
  content: ContentStore;
  checkpoints: CheckpointStore;
  traces: TraceStore;
};
