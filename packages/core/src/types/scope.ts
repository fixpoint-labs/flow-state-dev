import type { AgentType, ItemStatus } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { AnyResourceRef, ResourceRegistry } from "./resource";
import type { CostEstimate, TokenLedger } from "./flow";
import type { ScopeStateOps } from "./state";

export type ScopeType = "request" | "session" | "user" | "org";

export type ScopeIdentity = {
  type: ScopeType;
  id: string;
  userId?: string;
  orgId?: string;
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
  /** Identity of the producing agent (post-FIX-391). */
  agentType?: AgentType;
  agentName?: string;
};

export type MessageLimit = number | { tokens: number };

export type ItemQuery = {
  limit?: MessageLimit;
  includeTransient?: boolean;
  itemTypes?: string[];
  roles?: Array<"user" | "assistant" | "system" | "developer" | "tool">;
  /** Filter by producing agent type. Scalar or array form. */
  agentType?: AgentType | AgentType[];
  /** Filter by producing agent name. Scalar or array form. */
  agentName?: string | string[];
};

export type SessionItemViews = {
  /** Every session item. Respects `includeTransient`. No visibility filter. */
  all: (query?: ItemQuery) => SessionItem[];
  /** Items where `resolveItemVisibility(item).client === true`. Excludes trace items. */
  client: (query?: ItemQuery) => SessionItem[];
  /**
   * LLM-ready conversation history. Applies the transient filter, the type
   * allowlist, `resolveItemVisibility(item).history`, role filtering, and
   * limiting. Effectively returns only items whose resolved visibility
   * includes them in history (agent-typed conversational items + user
   * messages).
   */
  history: (query?: ItemQuery) => Promise<LLMMessage[]>;
  /**
   * Raw-query view for custom context assembly. Returns `SessionItem[]`
   * unfiltered by visibility. Respects `includeTransient` per query, and
   * honors the `agentType` / `agentName` filters. Use this to build
   * custom prompt context that reaches beyond the conversation-history
   * default (e.g., a long-running sub-agent pulling its own prior outputs).
   */
  selectForContext: (query?: ItemQuery) => SessionItem[];
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

export type OrgScopeHandle<
  TState extends object = Record<string, unknown>,
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  resources?: ResourceRegistry<TResources>;
} & ScopeStateOps<TState>;
