// Capture behaviours (FIX-882, behaviours 1–7), driven through the real
// `runAction` engine via `testFlow`. The flow has zero generators, so no model
// mocking is needed. Records are read back both via `listInbox` (the inspection
// surface) and directly off the user-scope store.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";
import type { InboxRecord } from "../src/inbox";

const USER = "owner";

type Stores = ReturnType<typeof createInMemoryStores>;

function capture(stores: Stores, input: Record<string, unknown>) {
  // Default a conversationId (now required) so these FIX-882 behaviours — which test
  // kind/content/situation dedup, not grouping — keep asserting the same thing.
  // A test that cares about the conversation id overrides it.
  return testFlow({
    flow: knowledgeHubFlow,
    action: "logActivity",
    userId: USER,
    stores,
    input: { conversationId: "conv_test", ...input },
  });
}

function list(stores: Stores, input: Record<string, unknown> = {}) {
  return testFlow({ flow: knowledgeHubFlow, action: "listInbox", userId: USER, stores, input });
}

/** All stored inbox records for the owner, keyed by storage path. */
async function storedRecords(stores: Stores): Promise<Record<string, InboxRecord>> {
  return toBareStates<InboxRecord>(await stores.resourceState.getAll("user", USER));
}

let stores: Stores;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("logActivity", () => {
  it("creates a pending record carrying kind, verbatim content, situation, capturedAt, and a fingerprint (behaviour 1)", async () => {
    const result = await capture(stores, {
      kind: "task",
      content: "Book dentist appointment",
      situation: "Mentioned while planning the week in a Claude conversation",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({ deduplicated: false });
    const output = result.output as { id: string; capturedAt: string; deduplicated: boolean };
    expect(typeof output.id).toBe("string");
    expect(typeof output.capturedAt).toBe("string");

    const records = Object.values(await storedRecords(stores));
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.kind).toBe("task");
    expect(record.content).toBe("Book dentist appointment");
    expect(record.situation).toBe("Mentioned while planning the week in a Claude conversation");
    expect(record.status).toBe("pending");
    expect(typeof record.capturedAt).toBe("string");
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.occurredAt).toBeNull();
    expect(record.source).toBeNull();
  });

  it("rejects a missing situation and the error names the field (behaviour 2)", async () => {
    const result = await capture(stores, { kind: "thought", content: "A stray idea" });
    expect(result.status).not.toBe("completed");
    expect(result.error?.message).toMatch(/situation/);
    expect(Object.keys(await storedRecords(stores))).toHaveLength(0);
  });

  it("rejects whitespace-only content or situation (behaviour 3)", async () => {
    const blankContent = await capture(stores, { kind: "thought", content: "   ", situation: "ctx" });
    expect(blankContent.status).not.toBe("completed");
    const blankContext = await capture(stores, { kind: "thought", content: "c", situation: "  \t " });
    expect(blankContext.status).not.toBe("completed");
    expect(Object.keys(await storedRecords(stores))).toHaveLength(0);
  });

  it("stores leading/trailing whitespace verbatim when the value is non-blank (behaviour 3)", async () => {
    await capture(stores, { kind: "thought", content: "  padded thought  ", situation: "  padded ctx  " });
    const record = Object.values(await storedRecords(stores))[0];
    expect(record.content).toBe("  padded thought  ");
    expect(record.situation).toBe("  padded ctx  ");
  });

  it("treats an exact retry as a dedup — same id, no new record (behaviour 4)", async () => {
    const input = {
      kind: "decision",
      content: "Ship FIX-882 this week",
      situation: "Sprint planning",
    };
    const first = await capture(stores, input);
    const retry = await capture(stores, input);

    const firstOut = first.output as { id: string; capturedAt: string; deduplicated: boolean };
    const retryOut = retry.output as { id: string; capturedAt: string; deduplicated: boolean };
    expect(firstOut.deduplicated).toBe(false);
    expect(retryOut.deduplicated).toBe(true);
    expect(retryOut.id).toBe(firstOut.id);
    expect(retryOut.capturedAt).toBe(firstOut.capturedAt);
    expect(Object.keys(await storedRecords(stores))).toHaveLength(1);
  });

  it("keeps same content under a different situation as two records (behaviour 5)", async () => {
    await capture(stores, { kind: "task", content: "Follow up with Sam", situation: "Standup" });
    await capture(stores, { kind: "task", content: "Follow up with Sam", situation: "1:1 with Sam" });
    expect(Object.keys(await storedRecords(stores))).toHaveLength(2);
  });

  it("keeps same content + situation under a different kind as two records (behaviour 6)", async () => {
    await capture(stores, { kind: "task", content: "Renew passport", situation: "Trip planning" });
    await capture(stores, { kind: "memory", content: "Renew passport", situation: "Trip planning" });
    expect(Object.keys(await storedRecords(stores))).toHaveLength(2);
  });

  it("replaces a swept record with a fresh pending one on re-capture (edge case 4)", async () => {
    // The retry guarantee is bounded to the pending window: once the sweeper has
    // placed (swept) a record, an identical re-capture is a NEW mental event, not
    // a dedup — a fresh pending record replaces the swept copy at the same key.
    const input = { kind: "task", content: "Renew passport", situation: "Trip planning" };
    await capture(stores, input);
    const [path, record] = Object.entries(await storedRecords(stores))[0];
    await stores.resourceState.set("user", USER, path, { ...record, status: "swept" }, "any");

    const retry = await capture(stores, input);
    expect((retry.output as { deduplicated: boolean }).deduplicated).toBe(false);

    const records = await storedRecords(stores);
    expect(Object.keys(records)).toHaveLength(1); // replaced in place, not appended
    expect(records[path].status).toBe("pending");
  });
});

describe("listInbox (behaviour 7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty result on an empty inbox (not an error)", async () => {
    const result = await list(stores);
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ items: [], totalPending: 0, oldestPendingCapturedAt: null });
  });

  it("returns pending items newest-first with counts and the oldest age", async () => {
    // Deterministic capturedAt stamps so the ordering assertion is not flaky on
    // sub-millisecond captures.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T09:00:00.000Z"));
    await capture(stores, { kind: "task", content: "oldest", situation: "c" });
    vi.setSystemTime(new Date("2026-07-10T10:00:00.000Z"));
    await capture(stores, { kind: "goal", content: "middle", situation: "c" });
    vi.setSystemTime(new Date("2026-07-10T11:00:00.000Z"));
    await capture(stores, { kind: "thought", content: "newest", situation: "c" });

    const result = await list(stores);
    const output = result.output as {
      items: { content: string }[];
      totalPending: number;
      oldestPendingCapturedAt: string | null;
    };
    expect(output.items.map((i) => i.content)).toEqual(["newest", "middle", "oldest"]);
    expect(output.totalPending).toBe(3);
    expect(output.oldestPendingCapturedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  it("filters by kind via the key prefix", async () => {
    await capture(stores, { kind: "task", content: "a task", situation: "c" });
    await capture(stores, { kind: "goal", content: "a goal", situation: "c" });
    const result = await list(stores, { kind: "task" });
    const output = result.output as { items: { kind: string }[]; totalPending: number };
    expect(output.items).toHaveLength(1);
    expect(output.items[0].kind).toBe("task");
    expect(output.totalPending).toBe(1);
  });

  it("respects limit while totalPending reports the full count", async () => {
    for (let i = 0; i < 5; i++) {
      await capture(stores, { kind: "thought", content: `thought ${i}`, situation: "c" });
    }
    const result = await list(stores, { limit: 2 });
    const output = result.output as { items: unknown[]; totalPending: number };
    expect(output.items).toHaveLength(2);
    expect(output.totalPending).toBe(5);
  });

  it("excludes swept records from items and totalPending", async () => {
    await capture(stores, { kind: "task", content: "to be swept", situation: "c" });
    // Simulate the FIX-883 sweeper marking the record swept, in place.
    const [path, record] = Object.entries(await storedRecords(stores))[0];
    await stores.resourceState.set("user", USER, path, { ...record, status: "swept" }, "any");

    const result = await list(stores);
    expect(result.output).toEqual({ items: [], totalPending: 0, oldestPendingCapturedAt: null });
  });
});
