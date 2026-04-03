import type {
  JournalEntry
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";

export type RequestStatus = "in_progress" | "completed" | "incomplete" | "failed" | "interrupted";

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
  projectId?: string;
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
  projectId?: string;
  status: RequestStatus;
  startedAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
  input?: unknown;
  items?: OutputItem[];
  interruptedAt?: number;
};

export type UserRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  userId: string;
  resources?: Record<string, JsonObject>;
  resourceContent?: Record<string, string>;
};

export type ProjectRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  projectId: string;
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

export type ProjectListOptions = {
  userId?: string;
  limit?: number;
  offset?: number;
};

export interface SessionStore {
  get(id: string): Promise<SessionRecord | undefined>;
  set(id: string, value: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(options?: SessionListOptions): Promise<SessionRecord[]>;
}

export interface RequestStore {
  get(id: string): Promise<RequestRecord | undefined>;
  set(id: string, value: RequestRecord): Promise<void>;
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
  set(id: string, value: UserRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(options?: UserListOptions): Promise<UserRecord[]>;
}

export interface ProjectStore {
  get(id: string): Promise<ProjectRecord | undefined>;
  set(id: string, value: ProjectRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(options?: ProjectListOptions): Promise<ProjectRecord[]>;
}

export type ActiveRequestEntry = {
  requestId: string;
  flowKind: string;
  actionName: string;
  sessionId?: string;
  userId: string;
  projectId?: string;
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

export type StoreRegistry = {
  session: SessionStore;
  request: RequestStore;
  user: UserStore;
  project: ProjectStore;
  activeRequests: ActiveRequestRegistry;
};
