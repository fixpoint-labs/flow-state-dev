/**
 * History assembly for the execution context runtime.
 *
 * Owns LLM history construction (prior-request expansion, turn-aware limiting,
 * token-budget packing), session item views (all/client/history/selectForContext),
 * and the journal entry builder. All functions are pure or fully parameterized —
 * no closure over createExecutionContext-local state.
 */

import type {
  ItemQuery,
  JournalEntry,
  JournalEntryInput,
  LLMMessage,
  MessageLimit,
  SessionItem,
  SessionItemViews,
  TokenCounter,
} from "@flow-state-dev/core/types";
import type {
  BlockTraceItem,
  Content,
  ItemVisibility,
  MessageItem,
  OutputItem,
  ToolOutputItem,
} from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import { sanitizeToolName } from "@flow-state-dev/core/helpers";
import {
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  failedToolResultText,
} from "@flow-state-dev/core/models";
import type { RequestRecord } from "../stores/types";

/**
 * Set of item types that enter LLM context.
 * `tool_output` is the dedicated tool-result type.
 */
export const LLM_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "tool_output"
]);

/**
 * Set of item types visible to the client.
 * `block_trace`, `context` are NOT client-visible.
 */
export const CLIENT_AUDIENCE_TYPES = new Set([
  "message",
  "reasoning",
  "component",
  "container",
  "tool_output",
  "status",
  "source",
  "state_change",
  "resource_change",
  "error",
]);

/**
 * Converts a persisted OutputItem into an LLM-ready message.
 *
 * Items with `history: false` (resolved via `resolveItemVisibility`) are
 * excluded. Returns an empty array for item types that don't map to
 * conversation messages (status, state_change, resource_change, etc.).
 *
 * `allItems` is used to resolve `block_output` BlockValue refs back to their
 * source items (FIX-413); pass the same list you're iterating over.
 */
export function itemToLLMMessages(item: OutputItem | BlockTraceItem, allItems: readonly (OutputItem | BlockTraceItem)[]): LLMMessage[] {
  if (!resolveItemVisibility(item as OutputItem).history) {
    return [];
  }

  if (item.type === "message") {
    const msg = item as MessageItem;
    const text = (msg.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    if (text.length === 0) {
      return [];
    }

    return [{ role: msg.role, content: text }];
  }

  if (item.type === "reasoning") {
    const summary = (item as { summary: Content[] }).summary ?? [];
    const text = summary
      .filter((c) => c.type === "output_text" || c.type === "reasoning_text")
      .map((c) => (c as { text: string }).text)
      .join("");

    return text.length > 0
      ? [{ role: "assistant", content: text }]
      : [];
  }

  if (item.type === "tool_output") {
    const bto = item as ToolOutputItem;
    const resultText = bto.status === "failed" && bto.error
      ? failedToolResultText(bto.toolCall.name, bto.error.message)
      : typeof bto.output === "string"
        ? bto.output
        : JSON.stringify(bto.output);

    let input: Record<string, unknown> = {};
    try { input = JSON.parse(bto.toolCall.arguments); } catch { /* use empty */ }
    // Replay uses the model-facing alias the LLM saw, not the framework
    // block name. Items written before the `alias` field existed fall back
    // to deriving it from `name`; once those have aged out, the fallback can
    // be removed.
    //
    // The call/result pair is built via the shared visibility-agnostic
    // builders in `@flow-state-dev/core/models` — the same mapping the
    // framework-owned generator step loop uses for its live inter-step
    // messages. This wrapper keeps the history-visibility gate (above) and
    // the replay-specific text shaping; only the message construction is
    // shared. History always replays results as a `text` payload (failed
    // calls included), the shape persisted sessions were built against.
    const replayName = bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name);
    const call = { toolCallId: bto.toolCall.callId, toolName: replayName };
    return [
      buildAssistantToolCallMessage([{ ...call, input }]),
      buildToolResultMessage(call, { type: "text", value: resultText })
    ];
  }

  return [];
}

/**
 * Trims orphaned tool messages from the start/end of a sliced message array.
 * AI SDK v6 requires assistant tool-call messages to be immediately followed
 * by their matching tool-result messages. When a numeric or token-based limit
 * slices mid-pair, the orphaned message causes models to produce empty output
 * (AI_NoOutputGeneratedError). This function:
 *  - Drops leading `tool` role messages (orphaned results without their call)
 *  - Drops trailing `assistant` messages that contain only tool-call parts
 *    (orphaned calls without their result)
 */
function trimOrphanedToolMessages(messages: LLMMessage[]): LLMMessage[] {
  let start = 0;
  let end = messages.length;

  // Trim leading orphaned tool-result messages
  while (start < end && messages[start]!.role === "tool") {
    start++;
  }

  // Trim trailing orphaned assistant tool-call messages
  while (end > start) {
    const last = messages[end - 1]!;
    if (last.role !== "assistant" || !Array.isArray(last.content)) break;
    const isToolCallOnly = last.content.every(
      (part: any) => part.type === "tool-call"
    );
    if (!isToolCallOnly) break;
    end--;
  }

  if (start === 0 && end === messages.length) return messages;
  return messages.slice(start, end);
}

/**
 * Expands the items of a single RequestRecord into LLM-ready messages.
 *
 * Applies, in order: a stable sort by `(ts, itemIndex)`, the transient
 * filter, the allowed-item-types filter, and `itemToLLMMessages` per item.
 * `itemToLLMMessages` internally applies `resolveItemVisibility` so
 * sub-agent and trace items are dropped here as well.
 *
 * `allowedRoles`, when set, drops any produced LLM message whose role is
 * not in the allowlist.
 *
 * Sort-equivalence assumption: this expands and sorts items per request,
 * not globally. That is safe because completed prior requests have
 * non-overlapping `(ts, itemIndex)` ranges — `priorRequests` is sorted by
 * `startedAtMs` and a completed request's items have timestamps strictly
 * within its lifetime. Concatenating expansions of pre-ordered requests
 * therefore preserves the same global ordering the previous flatten-then-
 * sort path produced.
 */
export function expandRequestToMessages(
  items: readonly (OutputItem | BlockTraceItem)[],
  allowedTypes: Set<string>,
  allowedRoles: Set<"user" | "assistant" | "system" | "developer" | "tool"> | undefined,
): LLMMessage[] {
  const sorted = [...items].sort((a, b) => {
    const tsDiff = a.ts - b.ts;
    return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
  });

  const out: LLMMessage[] = [];
  for (const item of sorted) {
    if (item.transient === true) continue;
    if (!allowedTypes.has(item.type)) continue;

    const llmMessages = itemToLLMMessages(item, sorted);
    for (const llmMessage of llmMessages) {
      if (
        allowedRoles !== undefined &&
        !allowedRoles.has(
          llmMessage.role as "user" | "assistant" | "system" | "developer" | "tool"
        )
      ) {
        continue;
      }
      out.push(llmMessage);
    }
  }
  return out;
}

export type SelectedTurn = { messages: LLMMessage[] };

/**
 * Selects which prior requests participate in history given the limit,
 * returning each selected turn's pre-expanded `LLMMessage[]` so callers
 * can assemble the final array without re-expanding.
 *
 * Turn-based (bare `number` or `{ turns: N }`): returns the last N
 * completed prior requests. Guards `Array.prototype.slice(-0)` — which
 * returns the whole array — by explicitly returning `[]` for N <= 0.
 *
 * Token-based (`{ tokens: T }`): walks `priorRequests` from the end,
 * expanding each candidate to its LLM messages and counting tokens. A
 * candidate is accepted whole if it fits the remaining budget; otherwise
 * walking stops (turns are never split). If the first (most recent) prior
 * turn alone exceeds the budget, it is accepted anyway — returning an
 * empty history when a single oversized turn exists hides more context
 * than it saves.
 *
 * `undefined` limit returns all prior requests.
 */
export async function selectRequestsByLimit(
  priorRequests: RequestRecord[],
  limit: MessageLimit | undefined,
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  allowedTypes: Set<string>,
  allowedRoles: Set<"user" | "assistant" | "system" | "developer" | "tool"> | undefined,
): Promise<SelectedTurn[]> {
  const expand = (request: RequestRecord): SelectedTurn => ({
    messages: expandRequestToMessages(
      request.items ?? [],
      allowedTypes,
      allowedRoles,
    ),
  });

  if (limit === undefined) {
    return priorRequests.map(expand);
  }

  // Turn-based: bare number or { turns: N }
  if (typeof limit === "number" || "turns" in limit) {
    const turns = typeof limit === "number" ? limit : limit.turns;
    if (turns <= 0) return [];
    return priorRequests.slice(-turns).map(expand);
  }

  // Token-based: pack whole turns from the end, never split. Each
  // candidate is expanded exactly once and the expansion is reused in
  // the final assembly — no double-expansion.
  const budget = limit.tokens;
  const model = resolveModelId();
  const selected: SelectedTurn[] = [];
  let runningTokens = 0;

  for (let i = priorRequests.length - 1; i >= 0; i--) {
    const turn = expand(priorRequests[i]!);
    const candidateTokens = turn.messages.length === 0
      ? 0
      : await tokenCounter.countMessages(turn.messages, model);

    if (selected.length === 0) {
      // Most-recent-turn exception: always include the latest prior turn
      // even if it alone exceeds the budget.
      selected.unshift(turn);
      runningTokens = candidateTokens;
      continue;
    }

    if (runningTokens + candidateTokens > budget) {
      break;
    }

    selected.unshift(turn);
    runningTokens += candidateTokens;
  }

  return selected;
}

/**
 * Loads conversation history from prior completed requests in this session,
 * converts to LLM-ready messages, and applies turn-aware limiting.
 *
 * `limit` is interpreted as a count of conversational turns, where one
 * `RequestRecord` is one turn. Tool-call/result messages within a retained
 * turn are carried full-fidelity and do not decrement the budget. This
 * fixes the original failure mode where a tool-heavy turn could fully
 * consume an `N`-message window and evict the prior user message.
 *
 * Token-based limits are turn-aligned: whole turns are packed from the
 * end and never split. The most recent prior turn is always included
 * (even if alone over budget). See `selectRequestsByLimit`.
 *
 * Live items from the current (in-flight) request are always appended
 * regardless of limit — this preserves the retry-after-mid-turn-failure
 * scenario where the user's "try again" must see the in-flight tool state.
 *
 * Empty-of-LLM-content turns (turns whose items are all sub-agent or
 * non-LLM types) still count against `{ turns: N }` but contribute zero
 * messages. This keeps the slice logic at the request level and matches
 * the spec's documented v1 behavior.
 *
 * Optionally includes items from the current in-flight request via
 * `readLiveItems` so that blocks like `sessionTitleGenerator` running as
 * background work can see the current request's output.
 */
export async function loadLLMHistory(
  priorRequests: RequestRecord[],
  tokenCounter: TokenCounter,
  resolveModelId: () => string,
  query?: ItemQuery,
  readLiveItems?: () => Array<OutputItem | BlockTraceItem>
): Promise<LLMMessage[]> {
  const allowedTypes = query?.itemTypes
    ? new Set(query.itemTypes)
    : LLM_AUDIENCE_TYPES;
  const allowedRoles = query?.roles ? new Set(query.roles) : undefined;

  const selectedTurns = await selectRequestsByLimit(
    priorRequests,
    query?.limit,
    tokenCounter,
    resolveModelId,
    allowedTypes,
    allowedRoles,
  );

  const messages: LLMMessage[] = [];
  for (const turn of selectedTurns) {
    messages.push(...turn.messages);
  }

  // Live items from the in-flight request are always included regardless
  // of limit. This is the retry/resume guarantee.
  if (readLiveItems !== undefined) {
    messages.push(
      ...expandRequestToMessages(readLiveItems(), allowedTypes, allowedRoles)
    );
  }

  // Defense-in-depth: with turn-aligned slicing orphans should be
  // structurally unreachable in normal operation, but keep the trim for
  // edge data states (e.g., a request whose items begin mid-tool-pair).
  return trimOrphanedToolMessages(messages);
}

/**
 * Converts an OutputItem (from the response emitter) to a SessionItem
 * so it can be included in the all() view alongside historical items.
 */
export function outputItemToSessionItem(item: OutputItem): SessionItem {
  // Extract readable content for the payload based on item type.
  // Message items get their text extracted; other items pass through.
  let payload: unknown;
  if (item.type === "message") {
    const msg = item as MessageItem;
    const texts = msg.content
      .filter((c: Content) => c.type === "output_text")
      .map((c) => (c as { type: "output_text"; text: string }).text);
    payload = texts.length > 0 ? texts.join("") : msg.content;
  } else {
    payload = (item as Record<string, unknown>).output ?? item;
  }

  return {
    id: item.id,
    type: item.type,
    status: item.status,
    transient: item.transient,
    requestId: item.requestId,
    itemIndex: item.itemIndex,
    payload,
    ts: item.ts,
    itemVisibility: item.itemVisibility,
    agentName: item.agentName,
  };
}

/**
 * Applies `itemVisibility` / `agentName` filters from a SessionItem query.
 * Returns true if the item passes the filter (or no filter applies).
 */
export function matchesIdentityFilter(
  item: SessionItem,
  query: ItemQuery | undefined,
): boolean {
  if (query?.itemVisibility !== undefined) {
    const resolved = resolveItemVisibility(item as unknown as OutputItem);
    if (resolved.client !== query.itemVisibility.client ||
        resolved.history !== query.itemVisibility.history) {
      return false;
    }
  }
  if (query?.agentName !== undefined) {
    const allowed = Array.isArray(query.agentName)
      ? new Set(query.agentName)
      : new Set([query.agentName]);
    if (item.agentName === undefined || !allowed.has(item.agentName)) {
      return false;
    }
  }
  return true;
}

function normalizeLimit(
  valuesLength: number,
  limit: MessageLimit | undefined
): number {
  if (limit === undefined) {
    return valuesLength;
  }

  if (typeof limit === "number") {
    return Math.max(0, Math.min(valuesLength, limit));
  }

  if ("turns" in limit) {
    return Math.max(0, Math.min(valuesLength, limit.turns));
  }

  return Math.max(0, Math.min(valuesLength, limit.tokens));
}

function listByQuery<TValue>(
  values: TValue[],
  query: { limit?: MessageLimit } | undefined
): TValue[] {
  const max = normalizeLimit(values.length, query?.limit);
  if (max >= values.length) {
    return [...values];
  }

  return values.slice(Math.max(0, values.length - max));
}

export function createSessionItemViews(
  priorItems: SessionItem[],
  priorRequests: RequestRecord[],
  options: {
    tokenCounter: TokenCounter;
    resolveModelId: () => string;
    readLiveItems?: () => Array<OutputItem | BlockTraceItem>;
  }
): SessionItemViews {
  // Compute once — priorItems is immutable for the request lifetime.
  const priorIds = new Set(priorItems.map((i) => i.id));

  const select = (
    query: ItemQuery | undefined,
    audienceTypes?: Set<string>,
    clientOnly?: boolean
  ): SessionItem[] => {
    const includeTransient = query?.includeTransient === true;
    const itemTypeFilter = query?.itemTypes
      ? new Set(query.itemTypes)
      : undefined;

    // Merge prior request items (loaded eagerly at context creation) with
    // live items from the current request's response emitter.
    const liveItems = options.readLiveItems?.() ?? [];
    const liveSessionItems = liveItems.map(outputItemToSessionItem);
    const deduplicatedLive = liveSessionItems.filter((i) => !priorIds.has(i.id));
    const allItems = [...priorItems, ...deduplicatedLive];

    const filtered = allItems.filter((item) => {
      if (!includeTransient && item.transient === true) {
        return false;
      }

      // Visibility-based audience filtering: client view uses resolveItemVisibility.
      if (clientOnly && !resolveItemVisibility(item as unknown as OutputItem).client) {
        return false;
      }

      // Type-based audience filtering when provided (for LLM audience).
      if (audienceTypes !== undefined && !audienceTypes.has(item.type)) {
        return false;
      }

      // Explicit item type filter from query.
      if (itemTypeFilter !== undefined && !itemTypeFilter.has(item.type)) {
        return false;
      }

      // Identity filters (itemVisibility, agentName) — honored by all views.
      if (!matchesIdentityFilter(item, query)) {
        return false;
      }

      return true;
    });

    return listByQuery(filtered, { limit: query?.limit });
  };

  return {
    all: (query) => select(query),
    client: (query) => select(query, undefined, true),
    history: (query) =>
      loadLLMHistory(
        priorRequests,
        options.tokenCounter,
        options.resolveModelId,
        query,
        options.readLiveItems
      ),
    selectForContext: (query) => select(query),
  };
}

export function buildJournalEntry(entry: JournalEntryInput): JournalEntry {
  return {
    id: `journal_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  };
}
