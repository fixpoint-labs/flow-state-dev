// Caller-supplied conversation behaviours (FIX-897), driven through the real
// `runAction` engine via `testFlow`. The flow has zero generators, so no model
// mocking is needed.
//
// NOTE: `testFlow` is the in-process (CLI-shaped) path — it supplies the
// sessionId directly and never consults the `mcp.session` directive. So these
// specs prove the handler/record side of the feature (createConversation stores the
// description and returns the session id; conversationId lands on the record and in
// the fingerprint; auto-vivify; validation). The directive → sessionId routing
// (the grouping mechanism) is proven at the MCP adapter layer
// (`packages/mcp/test/adapter.test.ts`) and end-to-end by the real-path goal
// check over the MCP HTTP endpoint.

import { describe, expect, it } from "vitest";
import { createInMemoryStores, toStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";
import type { InboxRecord } from "../src/inbox";

const USER = "owner";
type Stores = ReturnType<typeof createInMemoryStores>;

function openConversation(stores: Stores, sessionId: string, description: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "createConversation",
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
  return toStates<InboxRecord>(await stores.resourceState.getAll("user", USER));
}

/** The topic description stashed in a session's state (the conversation record). */
async function sessionDescription(stores: Stores, sessionId: string): Promise<unknown> {
  const rec = await stores.session.get(sessionId);
  return (rec?.state as { description?: unknown } | undefined)?.description ?? null;
}

describe("createConversation", () => {
  it("stores the description and returns the session id as conversationId", async () => {
    const stores = createInMemoryStores();
    const res = await openConversation(stores, "conv_planning", "Planning the Q3 roadmap");

    expect(res.status).toBe("completed");
    // The conversation id IS the session id (the session record is the conversation record).
    expect(res.output).toEqual({ conversationId: "conv_planning" });
    expect(await sessionDescription(stores, "conv_planning")).toBe("Planning the Q3 roadmap");
  });

  it("rejects a blank description", async () => {
    const stores = createInMemoryStores();
    const res = await openConversation(stores, "conv_blank", "   ");
    expect(res.status).not.toBe("completed");
  });
});

describe("logActivity conversationId", () => {
  it("stores the conversationId on the record and listInbox surfaces it", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "test-session", {
      conversationId: "conv_group",
      kind: "task",
      content: "ship it",
      situation: "standup",
    });

    const record = Object.values(await storedRecords(stores))[0];
    expect(record.conversationId).toBe("conv_group");

    const listed = await testFlow({
      flow: knowledgeHubFlow,
      action: "listInbox",
      userId: USER,
      stores,
      input: {},
    });
    const out = listed.output as { items: { conversationId: string }[] };
    expect(out.items[0].conversationId).toBe("conv_group");
  });

  it("both captures sharing a conversationId carry it — grouping is visible on inbox rows", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "s1", { conversationId: "conv_conv", kind: "task", content: "a", situation: "c" });
    await capture(stores, "s1", { conversationId: "conv_conv", kind: "goal", content: "b", situation: "c" });

    const records = Object.values(await storedRecords(stores));
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.conversationId === "conv_conv")).toBe(true);
  });

  it("keeps the same capture tuple under two conversations as two records (no cross-conversation dedup)", async () => {
    const stores = createInMemoryStores();
    const tuple = { kind: "task", content: "Follow up with Sam", situation: "Standup" } as const;
    await capture(stores, "s", { conversationId: "conv_one", ...tuple });
    await capture(stores, "s", { conversationId: "conv_two", ...tuple });
    expect(Object.keys(await storedRecords(stores))).toHaveLength(2);
  });

  it("auto-vivifies: a capture whose conversationId was never opened still succeeds, with no description", async () => {
    const stores = createInMemoryStores();
    // Mirror the MCP path (sessionId == conversationId) for an id that was never
    // opened via createConversation — the capture must not be lost to a missing
    // precondition, and the session carries no topic description.
    const res = await capture(stores, "conv_never_opened", {
      conversationId: "conv_never_opened",
      kind: "thought",
      content: "a stray idea",
      situation: "c",
    });

    expect(res.status).toBe("completed");
    expect(Object.values(await storedRecords(stores))[0].conversationId).toBe("conv_never_opened");
    expect(await sessionDescription(stores, "conv_never_opened")).toBeNull();
  });

  it("rejects a capture with no conversationId and the error names the field", async () => {
    const stores = createInMemoryStores();
    const res = await capture(stores, "s", { kind: "thought", content: "x", situation: "c" });
    expect(res.status).not.toBe("completed");
    expect(res.error?.message).toMatch(/conversationId/i);
    expect(Object.keys(await storedRecords(stores))).toHaveLength(0);
  });

  it("rejects a conversationId longer than 200 characters", async () => {
    const stores = createInMemoryStores();
    const res = await capture(stores, "s", {
      conversationId: "c".repeat(201),
      kind: "thought",
      content: "x",
      situation: "c",
    });
    expect(res.status).not.toBe("completed");
  });

  it("lists a legacy record in the pre-rename shape (`context`, no `conversationId`) without breaking (BP-030)", async () => {
    const stores = createInMemoryStores();
    // A record written in the ACTUAL pre-FIX-897-rename shape, straight to the
    // store: the per-capture text under the old `context` field, and no
    // `conversationId`. It must stay readable — the old text maps forward to
    // `situation` and the row lists as ungrouped `null`, not fail output
    // validation and take the whole inbox down.
    await stores.resourceState.set("user", USER, "inbox/task/deadbeef", {
      kind: "task",
      content: "legacy capture",
      context: "before the situation/conversation rename",
      capturedAt: "2026-07-10T00:00:00.000Z",
      occurredAt: null,
      source: null,
      status: "pending",
      fingerprint: "deadbeef",
    }, "any");

    const listed = await testFlow({
      flow: knowledgeHubFlow,
      action: "listInbox",
      userId: USER,
      stores,
      input: {},
    });
    expect(listed.status).toBe("completed");
    const out = listed.output as {
      items: { content: string; situation: string; conversationId: string | null }[];
      totalPending: number;
    };
    expect(out.totalPending).toBe(1);
    expect(out.items[0].content).toBe("legacy capture");
    // Old `context` value is surfaced under the new `situation` field.
    expect(out.items[0].situation).toBe("before the situation/conversation rename");
    expect(out.items[0].conversationId).toBeNull();
  });
});
