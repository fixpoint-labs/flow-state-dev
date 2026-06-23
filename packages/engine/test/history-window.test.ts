/**
 * Tests for flow-level history windowing (FIX-685 Slice C).
 *
 * The per-request execution context windows the cross-turn history load at
 * the store query — `request.list({ status:"completed", limit, orderBy:
 * "startedAtMs" })` — instead of loading the full session and trimming
 * afterward. The default generator's `history()` is bounded by the window;
 * per-call `history({ limit })` refines within it. A regression guard asserts
 * the terminal write order (flushItems before the completed patch) the window
 * relies on.
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, runAction } from "../src";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const noopHandler = handler({ name: "noop", execute: () => "ok" });

function assistantMessage(requestId: string, text: string): MessageItem {
  return {
    id: `${requestId}_msg`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "gen", blockInstanceId: "gen_1", phase: "main" },
    ts: 100
  };
}

function completedTurn(sessionId: string, n: number): RequestRecord {
  const id = `req_${n}`;
  return {
    id,
    flowKind: "win-flow",
    actionName: "run",
    userId: "u1",
    sessionId,
    status: "completed",
    startedAtMs: 1000 + n,
    completedAtMs: 1000 + n + 1,
    version: 1,
    createdAt: 1000 + n,
    updatedAt: 1000 + n + 1,
    state: {},
    items: [assistantMessage(id, `turn ${n}`) as unknown as OutputItem]
  };
}

async function seedTurns(stores: StoreRegistry, sessionId: string, count: number): Promise<void> {
  for (let n = 1; n <= count; n++) {
    await stores.request.set(`req_${n}`, completedTurn(sessionId, n), "any");
  }
}

function makeFlow(historyWindow?: { turns: number }) {
  return defineFlow({
    kind: "win-flow",
    session: historyWindow ? { historyWindow } : undefined,
    actions: { run: { inputSchema: z.string(), block: noopHandler } }
  })();
}

describe("history windowing (Slice C)", () => {
  it("lists prior requests with the default 50-turn window at the query level", async () => {
    const stores = createInMemoryStores();
    const listSpy = vi.spyOn(stores.request, "list");

    await createExecutionContext({
      flow: makeFlow(),
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_w",
      userId: "u1",
      stores
    });

    expect(listSpy).toHaveBeenCalledWith({
      sessionId: "sess_w",
      status: "completed",
      limit: 50,
      orderBy: "startedAtMs",
      withItems: true
    });
  });

  it("honors a flow-level historyWindow.turns override", async () => {
    const stores = createInMemoryStores();
    const listSpy = vi.spyOn(stores.request, "list");

    await createExecutionContext({
      flow: makeFlow({ turns: 7 }),
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_w2",
      userId: "u1",
      stores
    });

    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
  });

  it("bounds the default history() to the window, keeping the most recent turns", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_h", 5);

    const ctx = await createExecutionContext({
      flow: makeFlow({ turns: 3 }),
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_h",
      userId: "u1",
      stores
    });

    const messages = await ctx.session.items.history();
    // Only the 3 most-recently-started turns are loaded — not the full 5.
    expect(messages).toHaveLength(3);
    const texts = messages.map((m) =>
      Array.isArray(m.content)
        ? m.content.map((c: { text?: string }) => c.text ?? "").join("")
        : String(m.content)
    );
    expect(texts).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("per-call history({ turns }) refines within the loaded window", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_r", 5);

    const ctx = await createExecutionContext({
      flow: makeFlow({ turns: 50 }),
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_r",
      userId: "u1",
      stores
    });

    const messages = await ctx.session.items.history({ limit: { turns: 2 } });
    expect(messages).toHaveLength(2);
  });

  it("flushes items before the terminal completed patch (window ordering guard)", async () => {
    const stores = createInMemoryStores();
    const order: string[] = [];

    const origFlush = stores.request.flushItems.bind(stores.request);
    vi.spyOn(stores.request, "flushItems").mockImplementation(async (id: string) => {
      order.push("flush");
      return origFlush(id);
    });

    const origSet = stores.request.set.bind(stores.request);
    vi.spyOn(stores.request, "set").mockImplementation(async (id, record, ev) => {
      if ((record as RequestRecord).status === "completed") order.push("patch-completed");
      return origSet(id, record as RequestRecord, ev);
    });

    await runAction({
      flow: makeFlow(),
      actionName: "run",
      input: "x",
      userId: "u1",
      sessionId: "sess_order",
      stores,
      runtimeConfig: {}
    });

    const flushIdx = order.indexOf("flush");
    const patchIdx = order.indexOf("patch-completed");
    expect(flushIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeGreaterThan(flushIdx);
  });
});
