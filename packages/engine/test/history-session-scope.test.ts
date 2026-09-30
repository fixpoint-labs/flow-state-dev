/**
 * The history a run hands its model holds only the requests its session shows.
 *
 * When a run starts in an existing session, `createExecutionContext` loads the
 * session's completed requests as cross-turn history. The session's reads (its
 * request listing, snapshot and stream) show a request only when it matches
 * the session's tenant, owner, organization and flow — its kind, and its
 * owning instance when the session records one. The history load must apply
 * the same rule: a session written before admission bound runs to the
 * session's flow and owner can hold another flow's run, a same-kind peer
 * instance's run, or another user's, and none of those is this run's history.
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext, createInMemoryStores } from "../src";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src/stores/types";

const SESSION = "sess_mixed";

function chatFlow(id?: string) {
  const def = defineFlow({
    kind: "chat",
    actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } }
  });
  return id === undefined ? def() : def({ id });
}

async function seedSession(stores: StoreRegistry, flowId?: string): Promise<void> {
  const record: SessionRecord = {
    id: SESSION,
    flowKind: "chat",
    ...(flowId === undefined ? {} : { flowId }),
    userId: "alice",
    orgId: DEFAULT_ORG_ID,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    journal: []
  };
  await stores.session.set(SESSION, record, "any");
}

async function seedTurn(
  stores: StoreRegistry,
  n: number,
  text: string,
  owner: { flowKind?: string; flowId?: string; userId?: string } = {}
): Promise<void> {
  const id = `req_${n}`;
  const message: MessageItem = {
    id: `${id}_msg`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId: id,
    itemIndex: 0,
    provenance: { blockName: "gen", blockInstanceId: "gen_1", phase: "main" },
    ts: 100 + n
  };
  const record: RequestRecord = {
    id,
    flowKind: owner.flowKind ?? "chat",
    ...(owner.flowId === undefined ? {} : { flowId: owner.flowId }),
    actionName: "run",
    userId: owner.userId ?? "alice",
    orgId: DEFAULT_ORG_ID,
    sessionId: SESSION,
    status: "completed",
    startedAtMs: 1000 + n,
    completedAtMs: 1001 + n,
    version: 1,
    createdAt: 1000 + n,
    updatedAt: 1001 + n,
    state: {},
    items: [message as unknown as OutputItem]
  };
  await stores.request.set(id, record, "any");
}

/** The text of every message the run's model would receive as history. */
async function historyTexts(stores: StoreRegistry, flowId?: string): Promise<string[]> {
  const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: chatFlow(flowId),
    actionName: "run",
    requestId: "req_now",
    sessionId: SESSION,
    userId: "alice",
    stores
  });
  const messages = await ctx.session.items.history();
  return messages.map((m) =>
    Array.isArray(m.content)
      ? m.content.map((c: { text?: string }) => c.text ?? "").join("")
      : String(m.content)
  );
}

describe("a run's history is scoped like its session's reads", () => {
  it("leaves out another flow's run in a legacy session with no owning instance", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores);
    await seedTurn(stores, 1, "chat turn");
    await seedTurn(stores, 2, "other flow's turn", { flowKind: "billing" });

    expect(await historyTexts(stores)).toEqual(["chat turn"]);
  });

  it("leaves out a same-kind peer instance's run when the session records its owner", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores, "chat-west");
    await seedTurn(stores, 1, "west turn", { flowId: "chat-west" });
    await seedTurn(stores, 2, "east turn", { flowId: "chat-east" });

    expect(await historyTexts(stores, "chat-west")).toEqual(["west turn"]);
  });

  it("leaves out another user's run stored under the session's id", async () => {
    const stores = createInMemoryStores();
    await seedSession(stores);
    await seedTurn(stores, 1, "alice turn");
    await seedTurn(stores, 2, "bob turn", { userId: "bob" });

    expect(await historyTexts(stores)).toEqual(["alice turn"]);
  });
});
