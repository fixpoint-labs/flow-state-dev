// User-scope isolation (FIX-882, behaviour 8; BP-027). The inbox is
// `scope: "user"`, so one owner's captures must be invisible to another, and a
// single owner's captures must be shared across separate stateless calls.
//
// Expressed via `testFlow` over a shared in-memory store registry with two
// userIds — the hub has no capability harness to copy the knowledge-base
// user-scope spec's shape (Key Decision 5), and reintroducing one just to mirror
// that test would be wrong. Each simulated user gets a DISTINCT sessionId:
// `testFlow` defaults every call to `sessionId: "test-session"`, and reusing one
// user's session for another fails on a user-binding mismatch before it ever
// exercises resource isolation.

import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";

type Stores = ReturnType<typeof createInMemoryStores>;

function capture(stores: Stores, userId: string, sessionId: string, content: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "logActivity",
    userId,
    sessionId,
    stores,
    input: { contextId: sessionId, kind: "task", content, context: "isolation test" },
  });
}

function list(stores: Stores, userId: string, sessionId: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "listInbox",
    userId,
    sessionId,
    stores,
    input: {},
  });
}

describe("inbox user-scope isolation", () => {
  it("one owner's captures are invisible to another over the same store", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "ownerA", "sess-a", "ownerA's task");

    const bView = await list(stores, "ownerB", "sess-b");
    expect(bView.output).toMatchObject({ items: [], totalPending: 0 });

    const aView = await list(stores, "ownerA", "sess-a");
    const aOut = aView.output as { items: { content: string }[]; totalPending: number };
    expect(aOut.totalPending).toBe(1);
    expect(aOut.items[0].content).toBe("ownerA's task");
  });

  it("the same owner shares the inbox across separate stateless calls", async () => {
    const stores = createInMemoryStores();
    await capture(stores, "ownerA", "call-1", "written in call 1");

    const later = await list(stores, "ownerA", "call-2");
    const out = later.output as { items: { content: string }[]; totalPending: number };
    expect(out.totalPending).toBe(1);
    expect(out.items[0].content).toBe("written in call 1");
  });
});
