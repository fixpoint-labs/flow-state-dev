import type { ItemStatus, ItemVisibility, MessageItem } from "../items/types";
import type { JsonObject } from "../schema/common";
import type { CostEstimate, TokenLedger } from "./flow";
import type { ScopeStateOps } from "./state";

export type ScopeType = "request" | "session" | "user" | "org";

export type ScopeIdentity = {
  type: ScopeType;
  id: string;
  userId?: string;
  orgId?: string;
  /**
   * Optional tenant the request runs under (FIX-406 6D). Extracted from a
   * configurable HTTP header (default `x-tenant-id`) and exposed on request,
   * session, user, and org scope identities so handlers and lifecycle hooks can
   * branch on it. Undefined for single-tenant apps.
   *
   * When present, it also namespaces session storage (FIX-682): the session
   * record, session-scoped content/resource-state, and request history listing
   * isolate by tenant, so two tenants sharing a session id never share data.
   * User and org scopes stay shared across tenants by design.
   */
  tenantId?: string;
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
  /** Transport and memory visibility of this item. */
  itemVisibility?: ItemVisibility;
  agentName?: string;
  /**
   * A message item's `role`: `user` for the caller's message, `assistant` for
   * one the flow emitted. The framework writes no other role on a message
   * item. Absent on every other item type.
   */
  role?: MessageItem["role"];
};

/**
 * Bounds the number of items / messages / turns returned by a view.
 *
 * The bare `number` form is interpreted per-view:
 * - In `items.history()`, `N` means "the last N conversational turns" — a
 *   tool-heavy turn counts as one turn regardless of how many tool-call /
 *   tool-result protocol messages it produced.
 * - In `items.all()` and `items.client()`, `N` means "the last N items".
 *
 * `{ turns: N }` is the explicit form for turn-based limiting and is
 * intended for `items.history()`. It is also accepted by `items.all()`
 * and `items.client()` for type-system uniformity, but in those views it
 * is treated as a plain item count (`N` items, not "items from N turns")
 * — those views have no notion of a turn boundary. Prefer bare `number`
 * or omit the limit on the non-history views to avoid this fallback.
 *
 * `{ tokens: N }` is token-aware. In `items.history()` packing is turn-
 * aligned: whole turns are accepted from the end until adding the next
 * would exceed the budget. The most recent prior turn is always included
 * even if it alone exceeds the budget.
 */
export type MessageLimit = number | { tokens: number } | { turns: number };

export type ItemQuery = {
  limit?: MessageLimit;
  includeTransient?: boolean;
  itemTypes?: string[];
  roles?: Array<"user" | "assistant" | "system" | "developer" | "tool">;
  /** Filter by item visibility. Exact-match against resolved visibility. */
  itemVisibility?: ItemVisibility;
  /** Filter by producing agent name. Scalar or array form. */
  agentName?: string | string[];
  /**
   * Whether a view includes the in-flight request's items: `history()`
   * appends them after the prior turns, and `all()`, `client()`
   * and `selectForContext()` merge them after the prior items. Defaults to
   * `true`, so a retry after a mid-turn failure sees its own tool state. Pass
   * `false` for prior items only, for example to hand a model the earlier
   * conversation without the request that is running now.
   */
  includeInFlight?: boolean;
  /**
   * `history()` only: start after this turn (a request id), leaving it and
   * every earlier turn out. A turn the window no longer holds is older than
   * every turn it does, so naming one leaves the history whole. Applied before
   * `limit`. A history summary narrows with it: the summary stands for the
   * turns up to its mark.
   */
  afterRequestId?: string;
};

/**
 * One past turn of a session, as `items.turns()` lists it: the request that is
 * the turn, when it started, whether it has settled, and the messages the model
 * would read for it.
 */
export type HistoryTurn = {
  requestId: string;
  startedAtMs: number;
  /**
   * Whether the turn has finished for good. A turn still running, suspended on
   * a gate, or interrupted and parked to run again has not, and carries no
   * messages: what it says is not final until it settles.
   */
  settled: boolean;
  messages: LLMMessage[];
};

/** Which turns `items.turns()` lists. */
export type HistoryTurnQuery = {
  /**
   * These turns, by request id, whether or not the window still holds them.
   * Only this session's turns are read; an id that names none is left out.
   */
  requestIds?: readonly string[];
};

/**
 * The history window this request loaded (`session.historyWindow`), read-only.
 */
export type SessionHistoryWindow = {
  /** How many past turns the window holds. */
  readonly turns: number;
  /**
   * The first turn the window holds, when earlier turns have fallen out of it.
   * Absent while every earlier turn is still in the window. The request record
   * carries the same mark as `historyStart`.
   */
  readonly startRequestId?: string;
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
   * includes them in history (conversational items with history:true + user
   * messages).
   */
  history: (query?: ItemQuery) => Promise<LLMMessage[]>;
  /**
   * Raw-query view for custom context assembly. Returns `SessionItem[]`
   * unfiltered by visibility. Respects `includeTransient` per query, and
   * honors the `itemVisibility` / `agentName` filters. Use this to build
   * custom prompt context that reaches beyond the conversation-history
   * default (e.g., a long-running sub-agent pulling its own prior outputs).
   */
  selectForContext: (query?: ItemQuery) => SessionItem[];
  /**
   * The session's past turns, oldest first. With no query: the turns the
   * window holds, plus any turn of this session that has not settled yet
   * (running or suspended), so a caller can tell which turns are still open.
   * An interrupted turn is open too, since it can run again under its own id;
   * one a retry re-ran is listed settled with no messages instead: it holds a
   * place in the window, and history reads the retry.
   * With `requestIds`: those turns, read from the store when the
   * window no longer holds them.
   */
  turns: (query?: HistoryTurnQuery) => Promise<HistoryTurn[]>;
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
  /**
   * Which request this is, among every request that has held its id.
   *
   * Stamped once when this request is first recorded; one request, one value
   * for its whole life. A retry, a resume in another process, or a queued run
   * picking up the record its host wrote all read the same value.
   *
   * A request id can be chosen by the caller, and once a request's record is
   * deleted (session retention, for one) the same id can name a new request,
   * from the same user or another one. `identity.id` alone cannot tell the two
   * apart; this can. Anything keyed on a request id that outlives the request
   * (a scratch directory, a cache) must key on this too, or the next request
   * under that id inherits it.
   *
   * Opaque: compare it for equality, never parse it.
   */
  incarnation: string;
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

/**
 * What {@link SessionScopeHandle.stopRequest} came to.
 *
 * - `"stopped"`: the stop is recorded on the request. A request running in this
 *   process has its signal fired now; one running in another process is
 *   stopped on that process's next heartbeat, as an abort is.
 * - `"already-finished"`: the request had already ended; nothing was written.
 * - `"already-resolved"`: the request was parked, but what it waited on was
 *   resolved first (an answer won the race), so it is running again. Nothing
 *   was written; a second stop reaches the running turn.
 * - `"not-in-this-session"`: no request under that id belongs to this session
 *   (another session's, another tenant's, or none at all). Nothing was written,
 *   and the answer does not say which.
 */
export type StopRequestOutcome =
  | "stopped"
  | "already-finished"
  | "already-resolved"
  | "not-in-this-session";

/**
 * Session scope handle — exposes per-session state and metadata. Resources
 * have been lifted to the flat `ctx.resources` registry (FIX-435); a
 * resource's intrinsic `scope` routes its storage to the session record
 * for session-scoped definitions.
 */
export type SessionScopeHandle<
  TState extends object = Record<string, unknown>
> = {
  identity: ScopeIdentity;
  /**
   * The lineage id minted when this session's record was created. A session
   * deleted and created again under the same id gets a new one, so
   * `identity.id` plus this names one incarnation of the session.
   */
  readonly lineageId?: string;
  state: Readonly<TState>;
  metadata: Readonly<SessionMetadata>;
  items: SessionItemViews;
  /**
   * The history window this request loaded. Absent on a context that loads no
   * history (a test double, for one).
   */
  readonly window?: SessionHistoryWindow;
  appendJournal(entry: JournalEntryInput): Promise<void>;
  getJournal(options?: { limit?: number; offset?: number }): Promise<JournalEntry[]>;
  setMetadata(input: SessionMetadataInput): Promise<void>;
  /**
   * Stop another request running in this session, by its id.
   *
   * The same stop the abort route records for a client, reached from a block:
   * the request ends `aborted`. Only a request of this session can be stopped;
   * any other id answers `"not-in-this-session"`.
   */
  stopRequest(requestId: string): Promise<StopRequestOutcome>;
} & ScopeStateOps<TState>;

export type UserScopeHandle<
  TState extends object = Record<string, unknown>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
} & ScopeStateOps<TState>;

export type OrgScopeHandle<
  TState extends object = Record<string, unknown>
> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
} & ScopeStateOps<TState>;
