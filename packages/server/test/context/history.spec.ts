/**
 * Unit tests for context/history.ts — pure and parameterized functions only.
 *
 * Covers: loadLLMHistory, selectRequestsByLimit, expandRequestToMessages,
 * and createSessionItemViews over literal RequestRecord[] with mock
 * tokenCounter / readLiveItems. No live server, no ExecutionContext.
 */

import type { LLMMessage, SessionItem, TokenCounter } from "@flow-state-dev/core/types";
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import type { RequestRecord } from "../../src/stores/types";
import {
  createSessionItemViews,
  expandRequestToMessages,
  LLM_AUDIENCE_TYPES,
  loadLLMHistory,
  outputItemToSessionItem,
  selectRequestsByLimit,
} from "../../src/context/history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTokenCounter: TokenCounter = {
  count: async (text: string, _model: string) => Math.ceil(text.length / 4),
  countMessages: async (messages: LLMMessage[], _model: string) => {
    const total = messages.reduce(
      (acc, m) => acc + JSON.stringify(m.content).length,
      0
    );
    return Math.ceil(total / 4);
  },
};

const resolveModelId = () => "test-model";

function makeMessage(
  requestId: string,
  text: string,
  ts: number,
  itemIndex: number
): MessageItem {
  return {
    id: `${requestId}_msg_${itemIndex}`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId,
    itemIndex,
    provenance: { blockName: "gen", blockInstanceId: "gen_1", phase: "main" },
    ts,
  };
}

function makeRequest(
  id: string,
  items: OutputItem[],
  startedAtMs: number
): RequestRecord {
  return {
    id,
    flowKind: "test",
    actionName: "run",
    userId: "u1",
    sessionId: "s1",
    source: "http",
    status: "completed",
    startedAtMs,
    completedAtMs: startedAtMs + 100,
    version: 1,
    createdAt: startedAtMs,
    updatedAt: startedAtMs + 100,
    state: {},
    items,
  };
}

// ---------------------------------------------------------------------------
// expandRequestToMessages
// ---------------------------------------------------------------------------

describe("expandRequestToMessages", () => {
  it("returns LLM messages for allowed message items", () => {
    const items = [
      makeMessage("req1", "hello", 100, 0),
    ] as unknown as OutputItem[];

    const result = expandRequestToMessages(items, LLM_AUDIENCE_TYPES, undefined);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "assistant", content: "hello" });
  });

  it("sorts items by (ts, itemIndex) before expanding", () => {
    const items = [
      makeMessage("req1", "second", 200, 0),
      makeMessage("req1", "first", 100, 0),
    ] as unknown as OutputItem[];

    const result = expandRequestToMessages(items, LLM_AUDIENCE_TYPES, undefined);

    expect(result.map((m) => m.content)).toEqual(["first", "second"]);
  });

  it("uses itemIndex as tiebreaker when ts values are equal", () => {
    const items = [
      makeMessage("req1", "b", 100, 1),
      makeMessage("req1", "a", 100, 0),
    ] as unknown as OutputItem[];

    const result = expandRequestToMessages(items, LLM_AUDIENCE_TYPES, undefined);

    expect(result.map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("filters out transient items", () => {
    const item = {
      ...makeMessage("req1", "skip me", 100, 0),
      transient: true,
    } as unknown as OutputItem;

    const result = expandRequestToMessages([item], LLM_AUDIENCE_TYPES, undefined);

    expect(result).toHaveLength(0);
  });

  it("filters items not in allowedTypes", () => {
    const item = makeMessage("req1", "skip", 100, 0) as unknown as OutputItem;
    const narrowTypes = new Set(["tool_output"]);

    const result = expandRequestToMessages([item], narrowTypes, undefined);

    expect(result).toHaveLength(0);
  });

  it("filters messages by allowedRoles when provided", () => {
    const items = [
      makeMessage("req1", "assistant says", 100, 0),
    ] as unknown as OutputItem[];
    const userOnly = new Set<"user" | "assistant" | "system" | "developer" | "tool">(["user"]);

    const result = expandRequestToMessages(items, LLM_AUDIENCE_TYPES, userOnly);

    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty items list", () => {
    const result = expandRequestToMessages([], LLM_AUDIENCE_TYPES, undefined);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectRequestsByLimit
// ---------------------------------------------------------------------------

describe("selectRequestsByLimit", () => {
  const req1 = makeRequest("req1", [makeMessage("req1", "turn 1", 100, 0) as unknown as OutputItem], 1000);
  const req2 = makeRequest("req2", [makeMessage("req2", "turn 2", 200, 0) as unknown as OutputItem], 2000);
  const req3 = makeRequest("req3", [makeMessage("req3", "turn 3", 300, 0) as unknown as OutputItem], 3000);

  it("returns all turns when limit is undefined", async () => {
    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      undefined,
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    expect(result).toHaveLength(3);
  });

  it("returns last N turns for a bare number limit", async () => {
    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      2,
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    expect(result).toHaveLength(2);
    // Should be req2 and req3 (last 2)
    expect(result[0]!.messages[0]!.content).toBe("turn 2");
    expect(result[1]!.messages[0]!.content).toBe("turn 3");
  });

  it("returns last N turns for a { turns: N } limit", async () => {
    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      { turns: 1 },
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.messages[0]!.content).toBe("turn 3");
  });

  it("returns empty array for turns <= 0", async () => {
    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      0,
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    expect(result).toHaveLength(0);
  });

  it("packs turns from the end for token-based limit", async () => {
    // Each message is ~6 chars → ~2 tokens. Budget of 3 fits req3 + req2 (4 total) but not all 3.
    // Actually we need to be more precise: "turn 3" is 6 chars → ceil(6/4)=2 tokens per message wrap.
    // Let's use a very tight budget to verify only most-recent fits.
    const tightBudget = 1; // tokens — only the most-recent turn fits

    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      { tokens: tightBudget },
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    // Most-recent-turn exception: always includes at least the latest turn
    expect(result).toHaveLength(1);
    expect(result[0]!.messages[0]!.content).toBe("turn 3");
  });

  it("includes multiple turns when budget allows", async () => {
    // Large budget — all turns should fit
    const largeBudget = 10000;

    const result = await selectRequestsByLimit(
      [req1, req2, req3],
      { tokens: largeBudget },
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    expect(result).toHaveLength(3);
  });

  it("always includes the most-recent turn even when it alone exceeds the token budget", async () => {
    const bigRequest = makeRequest(
      "big",
      [makeMessage("big", "x".repeat(1000), 500, 0) as unknown as OutputItem],
      5000
    );

    const result = await selectRequestsByLimit(
      [req1, bigRequest],
      { tokens: 1 },
      mockTokenCounter,
      resolveModelId,
      LLM_AUDIENCE_TYPES,
      undefined
    );

    // The big (most recent) turn must be included despite exceeding budget
    expect(result).toHaveLength(1);
    expect(result[0]!.messages[0]!.content).toBe("x".repeat(1000));
  });
});

// ---------------------------------------------------------------------------
// loadLLMHistory
// ---------------------------------------------------------------------------

describe("loadLLMHistory", () => {
  const req1 = makeRequest("r1", [makeMessage("r1", "msg 1", 100, 0) as unknown as OutputItem], 1000);
  const req2 = makeRequest("r2", [makeMessage("r2", "msg 2", 200, 0) as unknown as OutputItem], 2000);

  it("returns messages from all prior requests when no limit", async () => {
    const messages = await loadLLMHistory(
      [req1, req2],
      mockTokenCounter,
      resolveModelId
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("msg 1");
    expect(messages[1]!.content).toBe("msg 2");
  });

  it("applies turn-based limit via query.limit", async () => {
    const messages = await loadLLMHistory(
      [req1, req2],
      mockTokenCounter,
      resolveModelId,
      { limit: { turns: 1 } }
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("msg 2");
  });

  it("appends live items from readLiveItems regardless of limit", async () => {
    const liveItem = makeMessage("r_live", "live msg", 300, 0) as unknown as OutputItem;
    const readLiveItems = () => [liveItem];

    const messages = await loadLLMHistory(
      [req1, req2],
      mockTokenCounter,
      resolveModelId,
      { limit: { turns: 0 } },
      readLiveItems
    );

    // limit: turns 0 → no prior turns, but live is always appended
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("live msg");
  });

  it("filters by itemTypes via query.itemTypes", async () => {
    const messages = await loadLLMHistory(
      [req1, req2],
      mockTokenCounter,
      resolveModelId,
      { itemTypes: ["tool_output"] }
    );

    // No tool_output items in the requests → empty result
    expect(messages).toHaveLength(0);
  });

  it("returns empty array when no requests and no live items", async () => {
    const messages = await loadLLMHistory([], mockTokenCounter, resolveModelId);
    expect(messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createSessionItemViews
// ---------------------------------------------------------------------------

describe("createSessionItemViews", () => {
  function makeSessionItem(id: string, type: string, requestId: string): SessionItem {
    return {
      id,
      type,
      status: "completed",
      requestId,
      itemIndex: 0,
      payload: `payload_${id}`,
      ts: 100,
    };
  }

  const prior1 = makeSessionItem("item_1", "message", "req1");
  const prior2 = makeSessionItem("item_2", "status", "req2");
  const priorItems = [prior1, prior2];
  const priorRequests: RequestRecord[] = [];

  const views = createSessionItemViews(priorItems, priorRequests, {
    tokenCounter: mockTokenCounter,
    resolveModelId,
  });

  it("all() returns all prior items", () => {
    const result = views.all();
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["item_1", "item_2"]);
  });

  it("client() filters to client-visible items only", () => {
    // message → client: true, status → client: true, block_trace → client: false
    const blockTrace = makeSessionItem("item_bt", "block_trace", "req3");
    const views2 = createSessionItemViews(
      [prior1, blockTrace],
      priorRequests,
      { tokenCounter: mockTokenCounter, resolveModelId }
    );

    const result = views2.client();
    // block_trace is not client-visible
    expect(result.every((i) => i.type !== "block_trace")).toBe(true);
    expect(result.some((i) => i.id === "item_1")).toBe(true);
  });

  it("all() includes live items from readLiveItems", () => {
    const liveOutput = makeMessage("req_live", "live text", 300, 0) as unknown as OutputItem;
    const views3 = createSessionItemViews(priorItems, priorRequests, {
      tokenCounter: mockTokenCounter,
      resolveModelId,
      readLiveItems: () => [liveOutput],
    });

    const result = views3.all();
    expect(result.some((i) => i.id === liveOutput.id)).toBe(true);
  });

  it("all() deduplicates live items that already appear in priorItems", () => {
    // Live item has the same id as prior1 — should appear only once
    const duplicateLive = {
      ...makeMessage("req1", "duplicate", 100, 0),
      id: prior1.id,
    } as unknown as OutputItem;

    const views4 = createSessionItemViews(priorItems, priorRequests, {
      tokenCounter: mockTokenCounter,
      resolveModelId,
      readLiveItems: () => [duplicateLive],
    });

    const result = views4.all();
    const matching = result.filter((i) => i.id === prior1.id);
    expect(matching).toHaveLength(1);
  });

  it("all() excludes transient items by default", () => {
    const transientItem: SessionItem = {
      ...makeSessionItem("item_t", "message", "req_t"),
      transient: true,
    };

    const views5 = createSessionItemViews(
      [...priorItems, transientItem],
      priorRequests,
      { tokenCounter: mockTokenCounter, resolveModelId }
    );

    const result = views5.all();
    expect(result.some((i) => i.id === "item_t")).toBe(false);
  });

  it("all({ includeTransient: true }) includes transient items", () => {
    const transientItem: SessionItem = {
      ...makeSessionItem("item_t2", "message", "req_t2"),
      transient: true,
    };

    const views6 = createSessionItemViews(
      [...priorItems, transientItem],
      priorRequests,
      { tokenCounter: mockTokenCounter, resolveModelId }
    );

    const result = views6.all({ includeTransient: true });
    expect(result.some((i) => i.id === "item_t2")).toBe(true);
  });

  it("history() returns LLM-ready messages from prior requests", async () => {
    const msgItem = makeMessage("req_h", "history text", 100, 0) as unknown as OutputItem;
    const req = makeRequest("req_h", [msgItem], 500);

    const views7 = createSessionItemViews([], [req], {
      tokenCounter: mockTokenCounter,
      resolveModelId,
    });

    const messages = await views7.history();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("history text");
  });

  it("selectForContext() returns items unfiltered by visibility", () => {
    const blockTrace = makeSessionItem("item_bt2", "block_trace", "req4");
    const views8 = createSessionItemViews(
      [prior1, blockTrace],
      priorRequests,
      { tokenCounter: mockTokenCounter, resolveModelId }
    );

    const result = views8.selectForContext();
    // selectForContext does not filter by client visibility
    expect(result.some((i) => i.id === "item_bt2")).toBe(true);
  });
});
