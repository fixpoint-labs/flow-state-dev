import type {
  JournalEntry,
  LLMMessage,
  Message,
  SessionItem
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { OutputItem } from "@flow-state-dev/core/items";

export type RequestStatus = "in_progress" | "completed" | "incomplete" | "failed";

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
  resources?: Record<string, JsonObject>;
  metadata?: Record<string, unknown>;
  latestRequestId?: string;
  journal: JournalEntry[];
  /** @deprecated Items are canonical on RequestRecord; aggregated on read via session state endpoint. */
  items?: SessionItem[];
  /** @deprecated Messages are derived projections from items; not stored on session. */
  messages?: {
    ui: Message[];
    llm: LLMMessage[];
  };
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
  items?: OutputItem[];
};

export type UserRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  userId: string;
  resources?: Record<string, JsonObject>;
};

export type ProjectRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  projectId: string;
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

export type StoreRegistry = {
  session: SessionStore;
  request: RequestStore;
  user: UserStore;
  project: ProjectStore;
};
