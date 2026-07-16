// Conversation context behaviours (FIX-897).

import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";
import type { ContextRecord } from "../src/contexts";

const USER = "owner";

type Stores = ReturnType<typeof createInMemoryStores>;

function openContext(stores: Stores, description: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "createContext",
    userId: USER,
    stores,
    input: { description },
  });
}

function capture(stores: Stores, input: Record<string, unknown>, sessionId?: string) {
  return testFlow({
    flow: knowledgeHubFlow,
    action: "logActivity",
    userId: USER,
    stores,
    sessionId,
    input,
  });
}

async function contextRecords(stores: Stores): Promise<Record<string, ContextRecord>> {
  const all = (await stores.resourceState.getAll("user", USER)) as Record<string, ContextRecord>;
  return Object.fromEntries(
    Object.entries(all).filter(([path]) => path.startsWith("contexts/"))
  );
}

let stores: Stores;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("createContext", () => {
  it("returns an id and stores description, openedAt, lazyOpened: false", async () => {
    const result = await openContext(stores, "Sprint planning chat");
    expect(result.status).toBe("completed");
    const output = result.output as { contextId: string; openedAt: string };
    expect(output.contextId).toMatch(/^kctx_/);
    expect(typeof output.openedAt).toBe("string");

    const records = await contextRecords(stores);
    expect(Object.keys(records)).toHaveLength(1);
    const record = Object.values(records)[0];
    expect(record.description).toBe("Sprint planning chat");
    expect(record.lazyOpened).toBe(false);
    expect(record.openedAt).toBe(output.openedAt);
  });
});

describe("logActivity + context", () => {
  it("lazy-opens an unknown contextId and still captures", async () => {
    const contextId = "kctx_lazy_1";
    const result = await capture(stores, {
      contextId,
      kind: "thought",
      content: "Remember to water plants",
      context: "Random aside",
    });
    expect(result.status).toBe("completed");

    const contexts = await contextRecords(stores);
    expect(contexts[`contexts/${contextId}`]).toMatchObject({
      description: null,
      lazyOpened: true,
    });
  });

  it("groups captures under the same session when sessionId matches contextId", async () => {
    const opened = await openContext(stores, "Topic");
    const contextId = (opened.output as { contextId: string }).contextId;

    await capture(
      stores,
      { contextId, kind: "task", content: "one", context: "c" },
      contextId
    );
    await capture(
      stores,
      { contextId, kind: "task", content: "two", context: "c" },
      contextId
    );

    const requests = await stores.request.list({ sessionId: contextId });
    expect(requests.length).toBeGreaterThanOrEqual(2);
  });
});
