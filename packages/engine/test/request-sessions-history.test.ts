/**
 * The request host's read of another session's settled turns (FIX-2173).
 *
 * Why it matters: a worker answers a question from another of the person's
 * conversations without waking it. The read must reach only the person's own
 * sessions (another user's, tenant's or org's reads exactly like a missing
 * one), must read what that conversation's own next turn would read and
 * nothing it would not (a running, suspended or parked turn, the unsettled
 * call of an interrupted one, a turn a retry re-ran), must say how fresh it is,
 * must be bounded at the store, and must write nothing to the session it reads.
 */
import type { MessageItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import { createRequestSessions } from "../src/context/request-sessions";
import { resolveSessionStorageKey } from "../src/stores/scope-keys";
import type { RequestRecord } from "../src/stores/types";

const provenance = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };
const deskFlow = { id: "desk", kind: "desk" } as unknown as FlowInstance;
const counter = {
  count: async (text: string) => Math.ceil(text.length / 4),
  countMessages: async (messages: { content: unknown }[]) =>
    Math.ceil(messages.reduce((n, m) => n + JSON.stringify(m.content).length, 0) / 4)
};

function message(requestId: string, role: "user" | "assistant", text: string, ts: number, itemIndex: number): OutputItem {
  const item: MessageItem = { id: `${requestId}_${itemIndex}`, type: "message", role, content: [{ type: "output_text", text }], status: "completed", requestId, itemIndex, provenance, ts };
  return item as unknown as OutputItem;
}

function unsettledCall(requestId: string, ts: number, itemIndex: number): OutputItem {
  return {
    id: `${requestId}_call`, type: "tool_output", status: "in_progress", requestId, itemIndex, provenance, ts, blockName: "lookUp",
    output: undefined, toolCall: { callId: "call_1", name: "lookUp", alias: "lookUp", arguments: "{}" }
  } as unknown as ToolOutputItem as unknown as OutputItem;
}

type Seed = { status?: RequestRecord["status"]; session?: string; userId?: string; metadata?: Record<string, unknown>; items?: OutputItem[]; completedAtMs?: number };

async function setup(options: { tenantId?: string } = {}) {
  const stores = createInMemoryStores();
  const tenantId = options.tenantId;
  const session = (id: string, over: Record<string, unknown> = {}) =>
    stores.session.set(
      resolveSessionStorageKey(id, tenantId),
      {
        id: resolveSessionStorageKey(id, tenantId), state: {}, version: 0, createdAt: 0, updatedAt: 0,
        flowKind: "worker", flowId: "worker-1", userId: "u1", orgId: "o1",
        ...(tenantId !== undefined ? { tenantId } : {}), journal: [], ...over
      } as never,
      "any"
    );
  const turn = (id: string, startedAtMs: number, text: string, seed: Seed = {}) =>
    stores.request.set(
      id,
      {
        ...(seed.metadata !== undefined ? { metadata: seed.metadata } : {}),
        id, flowKind: "worker", flowId: "worker-1", orgId: "o1", actionName: "chat", source: "http",
        userId: seed.userId ?? "u1", sessionId: seed.session ?? "writer", ...(tenantId !== undefined ? { tenantId } : {}),
        status: seed.status ?? "completed", startedAtMs, version: 1, createdAt: startedAtMs, updatedAt: startedAtMs + 5,
        ...(seed.completedAtMs !== undefined ? { completedAtMs: seed.completedAtMs } : {}),
        state: {},
        items: seed.items ?? [message(id, "user", text, startedAtMs, 0), message(id, "assistant", `ok: ${text}`, startedAtMs + 1, 1)]
      } as RequestRecord,
      "any"
    );
  await session("writer");
  const host = (identity: { userId: string; orgId: string; tenantId?: string } = { userId: "u1", orgId: "o1", tenantId }) =>
    createRequestSessions({
      sessions: stores.session,
      identity: { userId: identity.userId, orgId: identity.orgId, tenantId: identity.tenantId },
      flow: deskFlow,
      history: { requests: stores.request, runningRequestId: "req_running", tokenCounter: () => counter, resolveModelId: () => "m", onGateReadError: () => {} }
    });
  return { stores, session, turn, host };
}

const texts = (history: { turns: readonly { messages: readonly { content: unknown }[] }[] } | undefined) =>
  history?.turns.flatMap((t) => t.messages.map((m) => m.content)) ?? [];

describe("RequestHost.sessions.history", () => {
  it("reads another of the principal's sessions: its settled turns, oldest first, and when the newest settled", async () => {
    const { turn, host } = await setup();
    await turn("r1", 1000, "The venue is Hall K-41.", { completedAtMs: 1010 });
    await turn("r2", 2000, "And the date is May 3.", { completedAtMs: 2020 });
    const history = await host().history("writer");
    expect(texts(history)).toEqual(["The venue is Hall K-41.", "ok: The venue is Hall K-41.", "And the date is May 3.", "ok: And the date is May 3."]);
    expect(history?.turns.map((t) => [t.requestId, t.settled])).toEqual([["r1", true], ["r2", true]]);
    expect(history?.asOf).toEqual({ requestId: "r2", atMs: 2020 });
    expect(history?.running).toBe(false);
    expect(history?.startRequestId).toBeUndefined();
  });

  it("answers another user's, org's or tenant's session as it answers a missing one: absent, nothing read", async () => {
    const { session, turn, host } = await setup({ tenantId: "t1" });
    await session("theirs", { userId: "u2" });
    await turn("x1", 1000, "secret", { session: "theirs", userId: "u2" });
    expect(await host().history("theirs")).toBeUndefined();
    expect(await host().history("missing")).toBeUndefined();
    expect(await host().history("")).toBeUndefined();
    await turn("w1", 1000, "mine");
    expect(await host({ userId: "u2", orgId: "o1", tenantId: "t1" }).history("writer")).toBeUndefined();
    expect(await host({ userId: "u1", orgId: "o2", tenantId: "t1" }).history("writer")).toBeUndefined();
    expect(await host({ userId: "u1", orgId: "o1", tenantId: "t2" }).history("writer")).toBeUndefined();
    // The control: the owner reads it.
    expect(texts(await host().history("writer"))).toContain("mine");
  });

  it("never reads a turn still running or suspended, and says one is open", async () => {
    const { turn, host } = await setup();
    await turn("r1", 1000, "settled line");
    await turn("r2", 2000, "half-said line", { status: "in_progress" });
    await turn("r3", 3000, "waiting line", { status: "suspended" });
    const history = await host().history("writer");
    expect(texts(history)).toEqual(["settled line", "ok: settled line"]);
    expect(history?.running).toBe(true);
    expect(history?.asOf?.requestId).toBe("r1");
  });

  it("keeps an interrupted turn's settled items only, and leaves out one whose retry is still running", async () => {
    const { turn, host } = await setup();
    await turn("r1", 1000, "", { status: "interrupted", items: [message("r1", "user", "Check stock.", 1000, 0), unsettledCall("r1", 1001, 1)] });
    await turn("r2", 2000, "", { status: "interrupted", items: [message("r2", "user", "Draft the email.", 2000, 0)] });
    await turn("r3", 3000, "", { status: "in_progress", metadata: { retryOf: "r2" }, items: [message("r3", "user", "Draft the email.", 3000, 0)] });
    const history = await host().history("writer");
    // r1's call never settled, so only its message is read. r2 is being
    // re-run by r3, so it is not read at all, and r3 is not settled yet.
    expect(history?.turns.map((t) => t.requestId)).toEqual(["r1"]);
    expect(texts(history)).toEqual(["Check stock."]);
    expect(history?.running).toBe(true);
  });

  it("leaves out an interrupted turn parked to run again, and says a turn is open", async () => {
    const { stores, turn } = await setup();
    await turn("r1", 1000, "settled line");
    await turn("r2", 2000, "", { status: "interrupted", items: [message("r2", "user", "Approve the refund?", 2000, 0)] });
    const durability = {
      listSuspended: async () => [{ requestId: "r2", status: "pending" }],
      loadSuspension: async () => undefined
    } as never;
    const sessions = createRequestSessions({
      sessions: stores.session,
      identity: { userId: "u1", orgId: "o1", tenantId: undefined },
      flow: deskFlow,
      history: { requests: stores.request, runningRequestId: "req_running", durability, tokenCounter: () => counter, resolveModelId: () => "m", onGateReadError: () => {} }
    });
    const history = await sessions.history("writer");
    expect(history?.turns.map((t) => t.requestId)).toEqual(["r1"]);
    expect(history?.running).toBe(true);
  });

  it("never reads the running request, even when it runs in the session read", async () => {
    const { turn, host } = await setup();
    await turn("r1", 1000, "earlier");
    await turn("req_running", 2000, "now", { status: "completed" });
    expect((await host().history("writer"))?.turns.map((t) => t.requestId)).toEqual(["r1"]);
  });

  it("reads the newest turns under a turn limit, bounded at the store, and marks where it starts", async () => {
    const { stores, turn, host } = await setup();
    for (let i = 1; i <= 8; i++) await turn(`r${i}`, i * 1000, `line ${i}`);
    const listed: unknown[] = [];
    const list = stores.request.list.bind(stores.request);
    stores.request.list = (async (options) => {
      const rows = await list(options);
      listed.push(...rows);
      return rows;
    }) as typeof stores.request.list;
    const history = await host().history("writer", { limit: { turns: 3 } });
    expect(history?.turns.map((t) => t.requestId)).toEqual(["r6", "r7", "r8"]);
    expect(history?.startRequestId).toBe("r6");
    // Three turns and the one row that says an earlier turn exists: never all eight.
    expect(listed.length).toBe(4);
  });

  it("packs whole turns under a token limit, and keeps the newest turn whole even over it", async () => {
    const { turn, host } = await setup();
    await turn("r1", 1000, "x".repeat(400));
    await turn("r2", 2000, "y".repeat(40));
    await turn("r3", 3000, "z".repeat(40));
    const packed = await host().history("writer", { limit: { tokens: 50 } });
    expect(packed?.turns.map((t) => t.requestId)).toEqual(["r2", "r3"]);
    expect(packed?.startRequestId).toBe("r2");
    const newestOnly = await host().history("writer", { limit: { tokens: 1 } });
    expect(newestOnly?.turns.map((t) => t.requestId)).toEqual(["r3"]);
  });

  it("writes nothing to the session it reads", async () => {
    const { stores, turn, host } = await setup();
    await turn("r1", 1000, "line");
    const before = { session: await stores.session.get("writer"), requests: await stores.request.list({ sessionId: "writer", withItems: true }) };
    await host().history("writer");
    expect(await stores.session.get("writer")).toEqual(before.session);
    expect(await stores.request.list({ sessionId: "writer", withItems: true })).toEqual(before.requests);
  });

  it("reads nothing when the host wired no history", async () => {
    const { stores, turn } = await setup();
    await turn("r1", 1000, "line");
    const bare = createRequestSessions({ sessions: stores.session, identity: { userId: "u1", orgId: "o1", tenantId: undefined }, flow: deskFlow });
    expect(await bare.history("writer")).toBeUndefined();
    expect(await bare.read("writer")).toBeDefined();
  });
});
