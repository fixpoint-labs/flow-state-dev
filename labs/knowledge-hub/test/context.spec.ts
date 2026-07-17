// Caller-supplied context behaviours (FIX-897), driven through the real
// `runAction` engine via `testFlow`. The flow has zero generators, so no model
// mocking is needed.
//
// NOTE: `testFlow` is the in-process (CLI-shaped) path — it supplies the
// sessionId directly and never consults the `mcp.session` directive. So these
// specs prove the handler/record side of the feature (createContext stores the
// description and returns the session id; contextId lands on the record and in
// the fingerprint; auto-vivify; validation). The directive → sessionId routing
// (the grouping mechanism) is proven at the MCP adapter layer
// (`packages/mcp/test/adapter.test.ts`) and over real MCP HTTP in
// `test/config.spec.ts` (FIX-897) and `scripts/goal-check-fix-897.mts`.

import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";
import type { InboxRecord } from "../src/inbox";

const USER = "owner";
type Stores = ReturnType<typeof createInMemoryStores>;

function openContext(stores: Stores, sessionId: string, description: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "createContext",
    userId: USER,
    sessionId,
    stores,
    input: { description },
  });
}

function capture(stores: Stores, sessionId: string, input: Record<string, unknown>) {
  return testFlow({ flow: knowledgeHubFlow, action: "logActivity", userId: USER, sessionId, stores, input });
}

async function storedRecords(stores: Stores): Promise<Record<string, InboxRecord>> {
  return (await stores.resourceState.getAll("user", USER)) as Record<string, InboxRecord>;
}

/** The topic description stashed in a session's state (the context record). */
async function sessionDescription(stores: Stores, sessionId: string): Promise<unknown> {
  const rec = await stores.session.get(sessionId);
  return (rec?.state as { description?: unknown } | undefined)?.description ?? null;
}

describe("createContext", () => {
  it("stores the description and returns the session id as contextId", async () => {
    const stores = createInMemoryStores();
    const res = await openContext(stores, "ctx_planning", "Planning the Q3 roadmap");

    expect(res.status).toBe("completed");
    // The context id IS the session id (the session record is the context record).
    expect(res.output).toEqual({ contextId: "ctx_planning" });
    expect(await sessionDescription(stores, "ctx_planning")).toBe("Planning the Q3 roadmap");
  });

  it("rejects a blank description", async () => {
    const stores = createInMemoryStores();
    const res = await openContext(stores, "ctx_blank", "   ");
    expect(res.status).not.toBe("completed");
  });
});

describe("logActivity contextId", () => {
  it("stores the contextId on the record and listInbox surfaces it", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "test-session", {
      contextId: "ctx_group",
      kind: "task",
      content: "ship it",
      context: "standup",
    });

    const record = Object.values(await storedRecords(stores))[0];
    expect(record.contextId).toBe("ctx_group");

    const listed = await testFlow({
      flow: knowledgeHubFlow,
      action: "listInbox",
      userId: USER,
      stores,
      input: {},
    });
    const out = listed.output as { items: { contextId: string }[] };
    expect(out.items[0].contextId).toBe("ctx_group");
  });

  it("both captures sharing a contextId carry it — grouping is visible on inbox rows", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "s1", { contextId: "ctx_conv", kind: "task", content: "a", context: "c" });
    await capture(stores, "s1", { contextId: "ctx_conv", kind: "goal", content: "b", context: "c" });

    const records = Object.values(await storedRecords(stores));
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.contextId === "ctx_conv")).toBe(true);
  });

  it("keeps the same capture tuple under two contexts as two records (no cross-context dedup)", async () => {
    const stores = createInMemoryStores();
    const tuple = { kind: "task", content: "Follow up with Sam", context: "Standup" } as const;
    await capture(stores, "s", { contextId: "ctx_one", ...tuple });
    await capture(stores, "s", { contextId: "ctx_two", ...tuple });
    expect(Object.keys(await storedRecords(stores))).toHaveLength(2);
  });

  it("auto-vivifies: a capture whose contextId was never opened still succeeds, with no description", async () => {
    const stores = createInMemoryStores();
    // Mirror the MCP path (sessionId == contextId) for an id that was never
    // opened via createContext — the capture must not be lost to a missing
    // precondition, and the session carries no topic description.
    const res = await capture(stores, "ctx_never_opened", {
      contextId: "ctx_never_opened",
      kind: "thought",
      content: "a stray idea",
      context: "c",
    });

    expect(res.status).toBe("completed");
    expect(Object.values(await storedRecords(stores))[0].contextId).toBe("ctx_never_opened");
    expect(await sessionDescription(stores, "ctx_never_opened")).toBeNull();
  });

  it("rejects a capture with no contextId and the error names the field", async () => {
    const stores = createInMemoryStores();
    const res = await capture(stores, "s", { kind: "thought", content: "x", context: "c" });
    expect(res.status).not.toBe("completed");
    expect(res.error?.message).toMatch(/contextId/i);
    expect(Object.keys(await storedRecords(stores))).toHaveLength(0);
  });

  it("rejects a contextId longer than 200 characters", async () => {
    const stores = createInMemoryStores();
    const res = await capture(stores, "s", {
      contextId: "c".repeat(201),
      kind: "thought",
      content: "x",
      context: "c",
    });
    expect(res.status).not.toBe("completed");
  });

  it("lists a legacy record captured before contextId existed as ungrouped (BP-030)", async () => {
    const stores = createInMemoryStores();
    // A pre-FIX-897 inbox record written straight to the store — no contextId
    // field. It must stay readable (list as ungrouped `null`), not break listInbox.
    await stores.resourceState.set("user", USER, "inbox/task/deadbeef", {
      kind: "task",
      content: "legacy capture",
      context: "before contextId existed",
      capturedAt: "2026-07-10T00:00:00.000Z",
      occurredAt: null,
      source: null,
      status: "pending",
      fingerprint: "deadbeef",
    });

    const listed = await testFlow({
      flow: knowledgeHubFlow,
      action: "listInbox",
      userId: USER,
      stores,
      input: {},
    });
    expect(listed.status).toBe("completed");
    const out = listed.output as { items: { content: string; contextId: string | null }[]; totalPending: number };
    expect(out.totalPending).toBe(1);
    expect(out.items[0].content).toBe("legacy capture");
    expect(out.items[0].contextId).toBeNull();
  });
});
