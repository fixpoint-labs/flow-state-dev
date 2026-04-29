import type {
  JournalEntry,
  SequencerCheckpoint
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";

export type RequestStatus = "in_progress" | "completed" | "incomplete" | "failed" | "interrupted" | "aborted";

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
  resourceContent?: Record<string, string>;
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
  resourceContent?: Record<string, string>;
};

export type OrgRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  orgId: string;
  userId?: string;
  resources?: Record<string, JsonObject>;
  resourceContent?: Record<string, string>;
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

export interface SessionStore {
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

export interface RequestStore {
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
   * Returns events sorted by sequence_number.
   * Used for completed-request replay instead of item-based reconstruction.
   */
  getEvents(requestId: string): Promise<RequestStreamEvent[]>;
}

export interface UserStore {
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

export interface OrgStore {
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

export type StoreRegistry = {
  session: SessionStore;
  request: RequestStore;
  user: UserStore;
  org: OrgStore;
  activeRequests: ActiveRequestRegistry;
  content: ContentStore;
  checkpoints: CheckpointStore;
};
