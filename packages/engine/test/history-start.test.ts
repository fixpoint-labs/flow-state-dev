/**
 * Tests for the history window's mark and the generic reads a history summary
 * builds on (FIX-1613): `historyStart` on the request record, the read-only
 * `ctx.session.window`, `history({ afterRequestId })`, and `items.turns()`.
 *
 * Each turn records where the turns it read begin, so a screen can draw a
 * divider before them and say the turns above are out of view. A summary
 * (core's `historySummary`) reads the window to know which turns are about to
 * leave it, narrows history to the turns after its mark, and reads a turn that
 * left the window by id once it settles.
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext, createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
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

function turn(sessionId: string, n: number, overrides: Partial<RequestRecord> = {}): RequestRecord {
  const id = `req_${n}`;
  return {
    id,
    flowKind: "mark-flow",
    flowId: "mark-flow",
    orgId: DEFAULT_ORG_ID,
    actionName: "run",
    source: "http",
    userId: "u1",
    sessionId,
    status: "completed",
    startedAtMs: 1000 + n,
    completedAtMs: 1000 + n + 1,
    version: 1,
    createdAt: 1000 + n,
    updatedAt: 1000 + n + 1,
    state: {},
    items: [assistantMessage(id, `turn ${n}`) as unknown as OutputItem],
    ...overrides
  };
}

async function seedTurns(stores: StoreRegistry, sessionId: string, count: number): Promise<void> {
  for (let n = 1; n <= count; n++) {
    await stores.request.set(`req_${n}`, turn(sessionId, n), "any");
  }
}

function makeFlow(turns: number) {
  return defineFlow({
    kind: "mark-flow",
    session: { historyWindow: { turns } },
    actions: { run: { inputSchema: z.string(), block: noopHandler } }
  })();
}

async function contextFor(stores: StoreRegistry, sessionId: string, turns: number) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: makeFlow(turns),
    actionName: "run",
    requestId: "req_cur",
    sessionId,
    userId: "u1",
    stores
  });
}

function textOf(message: { content: unknown }): string {
  return Array.isArray(message.content)
    ? message.content.map((c: { text?: string }) => c.text ?? "").join("")
    : String(message.content);
}

describe("historyStart: where the turns a request read begin", () => {
  it("records the first turn the window holds once earlier turns fall out of it", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_out", 5);

    const ctx = await contextFor(stores, "sess_out", 3);

    // The window still holds exactly three turns: the extra row read to learn
    // whether anything fell out never reaches history.
    expect((await ctx.session.items.history()).map(textOf)).toEqual(["turn 3", "turn 4", "turn 5"]);
    expect(ctx.session.window).toEqual({ turns: 3, startRequestId: "req_3" });
    const record = await stores.request.get("req_cur");
    expect(record?.historyStart).toEqual({ requestId: "req_3" });
  });

  it("reaches a screen through the session's request list", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_list", 5);
    const flow = makeFlow(3);
    await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_list",
      userId: "u1",
      stores
    });
    const registry = createFlowRegistry();
    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    const path = ["sessions", "sess_list", "requests"];
    const response = await router.GET(new Request(`http://localhost/api/flows/${path.join("/")}`), { params: { path } });

    const { requests } = (await response.json()) as { requests: { id: string; historyStart?: unknown }[] };
    expect(requests.find((r) => r.id === "req_cur")?.historyStart).toEqual({ requestId: "req_3" });
  });

  it("records nothing while every earlier turn is still in the window", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_in", 3);

    const ctx = await contextFor(stores, "sess_in", 3);

    expect(ctx.session.window).toEqual({ turns: 3 });
    const record = await stores.request.get("req_cur");
    expect(record?.historyStart).toBeUndefined();
  });
});

describe("history({ afterRequestId })", () => {
  it("starts the history after the named turn", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_after", 5);

    const ctx = await contextFor(stores, "sess_after", 5);

    const messages = await ctx.session.items.history({ afterRequestId: "req_3" });
    expect(messages.map(textOf)).toEqual(["turn 4", "turn 5"]);
  });

  it("leaves the history whole when the named turn is older than the window", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_old", 5);

    const ctx = await contextFor(stores, "sess_old", 3);

    const messages = await ctx.session.items.history({ afterRequestId: "req_1" });
    expect(messages.map(textOf)).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("applies a limit after the narrowing", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_lim", 5);

    const ctx = await contextFor(stores, "sess_lim", 5);

    const messages = await ctx.session.items.history({ afterRequestId: "req_3", limit: { turns: 5 } });
    expect(messages.map(textOf)).toEqual(["turn 4", "turn 5"]);
  });
});

describe("items.turns()", () => {
  it("lists the window's turns oldest first, each with its id, start and messages", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_turns", 4);

    const ctx = await contextFor(stores, "sess_turns", 3);

    const turns = await ctx.session.items.turns();
    expect(turns.map((t) => [t.requestId, t.startedAtMs, t.settled, t.messages.map(textOf)])).toEqual([
      ["req_2", 1002, true, ["turn 2"]],
      ["req_3", 1003, true, ["turn 3"]],
      ["req_4", 1004, true, ["turn 4"]]
    ]);
  });

  it("lists a turn that has not settled as unsettled, with no messages", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_open", 3);
    await stores.request.set("req_2", turn("sess_open", 2, { status: "suspended", completedAtMs: undefined }), "any");

    const ctx = await contextFor(stores, "sess_open", 5);

    const turns = await ctx.session.items.turns();
    expect(turns.map((t) => [t.requestId, t.settled, t.messages.length])).toEqual([
      ["req_1", true, 1],
      ["req_2", false, 0],
      ["req_3", true, 1]
    ]);
  });

  it("reads a turn that left the window by id", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_byid", 5);

    const ctx = await contextFor(stores, "sess_byid", 2);

    const turns = await ctx.session.items.turns({ requestIds: ["req_1"] });
    expect(turns.map((t) => [t.requestId, t.settled, t.messages.map(textOf)])).toEqual([
      ["req_1", true, ["turn 1"]]
    ]);
  });

  it("never reads another session's turn by id", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_mine", 2);
    await stores.request.set("req_other", { ...turn("sess_theirs", 9), id: "req_other" }, "any");

    const ctx = await contextFor(stores, "sess_mine", 5);

    const turns = await ctx.session.items.turns({ requestIds: ["req_other", "req_missing"] });
    expect(turns).toEqual([]);
  });
});
