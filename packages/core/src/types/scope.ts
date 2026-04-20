import type { ItemStatus } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { AnyResourceRef, ResourceRegistry } from "./resource";
import type { CostEstimate, TokenLedger } from "./flow";
import type { ScopeStateOps } from "./state";

export type ScopeType = "request" | "session" | "user" | "project";

export type ScopeIdentity = {
  type: ScopeType;
  id: string;
  userId?: string;
  projectId?: string;
};

export type SessionItem = {
  id: string;
  type: string;
  status: ItemStatus;
  transient?: boolean;
  requestId: string;
  itemIndex: number;
  payload: unknown;
  ts?: number;
};

export type MessageLimit = number | { tokens: number };

export type ItemQuery = {
  limit?: MessageLimit;
  includeTransient?: boolean;
  itemTypes?: string[];
  roles?: Array<"user" | "assistant" | "system" | "developer" | "tool">;
};

export type SessionItemViews = {
  all: (query?: ItemQuery) => SessionItem[];
  client: (query?: ItemQuery) => SessionItem[];
  history: (query?: ItemQuery) => Promise<LLMMessage[]>;
};

export type Message = {
  id: string;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | JsonObject | JsonObject[];
  ts?: number;
};

export type LLMMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: unknown;
};

export type MessageQuery = {
  limit?: MessageLimit;
};

export type MessageViews = {
  ui: (query?: MessageQuery) => Message[];
  history: (query?: MessageQuery) => LLMMessage[];
};

export type JournalEntry = {
  id: string;
  ts: number;
  text: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type JournalEntryInput = Omit<JournalEntry, "id" | "ts">;

export type RequestScopeHandle<TState extends object = Record<string, unknown>> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  tokenUsage: TokenLedger;
  costEstimate: CostEstimate;
} & ScopeStateOps<TState>;

/** The readable first-class metadata fields on a session. */
export type SessionMetadata = {
  title?: string;
  description?: string;
  tags?: string[];
};

/**
 * Write input for setMetadata — includes first-class fields plus an arbitrary
 * metadata bag for ad-hoc key-value storage.
 */
export type SessionMetadataInput = SessionMetadata & {
  metadata?: Record<string, unknown>;
};

export type SessionScopeHandle<
  TState extends object = Record<string, unknown>,
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  metadata: Readonly<SessionMetadata>;
  resources: ResourceRegistry<TResources>;
  items: SessionItemViews;
  appendJournal(entry: JournalEntryInput): Promise<void>;
  getJournal(options?: { limit?: number; offset?: number }): Promise<JournalEntry[]>;
  setMetadata(input: SessionMetadataInput): Promise<void>;
} & ScopeStateOps<TState>;

export type UserScopeHandle<
  TState extends object = Record<string, unknown>,
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  resources: ResourceRegistry<TResources>;
} & ScopeStateOps<TState>;

export type ProjectScopeHandle<
  TState extends object = Record<string, unknown>,
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  resources?: ResourceRegistry<TResources>;
} & ScopeStateOps<TState>;
