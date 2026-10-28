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

  it("keeps the turn the store ranks newest when two turns tie at the window's edge", async () => {
    const stores = createInMemoryStores();
    // Same start millisecond: the store breaks the tie by id, descending, so
    // req_2 is the most recent turn and the one a one-turn window holds, as
    // it did before the extra row was read.
    await stores.request.set("req_1", turn("sess_tie", 1, { startedAtMs: 1001 }), "any");
    await stores.request.set("req_2", turn("sess_tie", 2, { startedAtMs: 1001 }), "any");

    const ctx = await contextFor(stores, "sess_tie", 1);

    expect((await ctx.session.items.history()).map(textOf)).toEqual(["turn 2"]);
    expect(ctx.session.window).toEqual({ turns: 1, startRequestId: "req_2" });
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

  it("starts after the named turn when that turn has not settled", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_open_mark", 5);
    await stores.request.set("req_2", turn("sess_open_mark", 2, { status: "suspended", completedAtMs: undefined }), "any");

    const ctx = await contextFor(stores, "sess_open_mark", 8);

    // A summary moved its mark past the waiting turn: turn 1 is in it, and
    // must not be read again.
    const messages = await ctx.session.items.history({ afterRequestId: "req_2" });
    expect(messages.map(textOf)).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("starts after the named turn when that turn is the one resuming now", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_resumed_mark", 5);
    // A turn that waited since just after turn 2 resumes as this request; a
    // summary had moved its mark onto it.
    await stores.request.set("req_cur", { ...turn("sess_resumed_mark", 2), id: "req_cur", status: "in_progress", completedAtMs: undefined, items: [] }, "any");

    const ctx = await contextFor(stores, "sess_resumed_mark", 8);

    // Turns 1 and 2 are in the summary, and must not be read again.
    const messages = await ctx.session.items.history({ afterRequestId: "req_cur" });
    expect(messages.map(textOf)).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("leaves the history whole when the named turn is older than the window", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_old", 5);

    const ctx = await contextFor(stores, "sess_old", 3);

    const messages = await ctx.session.items.history({ afterRequestId: "req_1" });
    expect(messages.map(textOf)).toEqual(["turn 3", "turn 4", "turn 5"]);
  });

  it("reads nothing when the named turn is newer than every turn the window holds", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_newer", 4);

    // This request loaded turns 1-4; another request then summarized through
    // turn 8, which this request never loaded.
    const ctx = await contextFor(stores, "sess_newer", 8);
    for (let n = 5; n <= 8; n++) await stores.request.set(`req_${n}`, turn("sess_newer", n), "any");

    const messages = await ctx.session.items.history({ afterRequestId: "req_8" });
    expect(messages.map(textOf)).toEqual([]);
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

  it("orders turns that share a start time the same way whether or not they have settled", async () => {
    const stores = createInMemoryStores();
    await stores.request.set("req_1", turn("sess_tie_open", 1, { startedAtMs: 1001, status: "suspended", completedAtMs: undefined }), "any");
    await stores.request.set("req_2", turn("sess_tie_open", 2, { startedAtMs: 1001 }), "any");

    const whileOpen = await (await contextFor(stores, "sess_tie_open", 4)).session.items.turns();
    await stores.request.set("req_1", turn("sess_tie_open", 1, { startedAtMs: 1001 }), "any");
    const onceSettled = await (await contextFor(stores, "sess_tie_open", 4)).session.items.turns();

    // A summary's mark is a position in this list: a turn that settles must
    // not move to the other side of a sibling the mark already passed.
    expect(whileOpen.map((t) => t.requestId)).toEqual(["req_1", "req_2"]);
    expect(onceSettled.map((t) => t.requestId)).toEqual(["req_1", "req_2"]);
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

  it("lists an interrupted turn /continue can re-enter as unsettled, in the window and by id", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_cut", 3);
    await stores.request.set("req_2", turn("sess_cut", 2, { status: "interrupted" }), "any");

    const ctx = await contextFor(stores, "sess_cut", 5);

    // Continuing it adds output under the same id: it has not settled.
    const listed = await ctx.session.items.turns();
    expect(listed.find((t) => t.requestId === "req_2")).toMatchObject({ settled: false, messages: [] });
    const byId = await ctx.session.items.turns({ requestIds: ["req_2"] });
    expect(byId.map((t) => [t.requestId, t.settled, t.messages.length])).toEqual([["req_2", false, 0]]);
  });

  it("reads an interrupted turn a retry re-ran by id as settled with nothing to read", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_retried", 3);
    await stores.request.set("req_2", turn("sess_retried", 2, { status: "interrupted" }), "any");
    await stores.request.set("req_3", turn("sess_retried", 3, { metadata: { retryOf: "req_2" } }), "any");

    const ctx = await contextFor(stores, "sess_retried", 5);

    // History reads the retry; by id, the cut-off original must not bring its
    // partial output back beside it.
    const byId = await ctx.session.items.turns({ requestIds: ["req_2"] });
    expect(byId.map((t) => [t.requestId, t.settled, t.messages.length])).toEqual([["req_2", true, 0]]);
    const listed = await ctx.session.items.turns();
    expect(listed.find((t) => t.requestId === "req_2")).toMatchObject({ settled: true, messages: [] });
  });

  it("reads a turn by id as it is now, not as the window loaded it", async () => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_fresh", 3);
    await stores.request.set("req_2", turn("sess_fresh", 2, { status: "interrupted", items: [] }), "any");

    const ctx = await contextFor(stores, "sess_fresh", 5);
    // It resumes and completes after this request loaded its window.
    await stores.request.set("req_2", turn("sess_fresh", 2), "any");

    const byId = await ctx.session.items.turns({ requestIds: ["req_2"] });
    expect(byId.map((t) => [t.requestId, t.settled, t.messages.map(textOf)])).toEqual([["req_2", true, ["turn 2"]]]);
  });

  it.each(["failed", "aborted"] as const)("reads a turn that %s by id as settled with nothing to read", async (status) => {
    const stores = createInMemoryStores();
    await seedTurns(stores, "sess_ended", 3);
    await stores.request.set("req_1", turn("sess_ended", 1, { status }), "any");

    const ctx = await contextFor(stores, "sess_ended", 5);

    // History never reads a turn that ended this way; a summary folding it by
    // id must not read its partial output either.
    const byId = await ctx.session.items.turns({ requestIds: ["req_1"] });
    expect(byId.map((t) => [t.requestId, t.settled, t.messages.length])).toEqual([["req_1", true, 0]]);
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
