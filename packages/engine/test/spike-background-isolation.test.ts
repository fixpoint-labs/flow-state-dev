/**
 * SPIKE (throwaway — FIX-939 design question, not a shipping test).
 *
 * Compares the two candidate models for detached/background work by running the
 * EXACT cross-turn history query `createExecutionContext.ts:526-536` issues:
 *
 *   A. background request = sibling request in the same session
 *   B. background work    = request in a sub-session
 *
 * The question is whether foreground history stays clean in each model, and
 * what it costs to make it so.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import type { RequestRecord } from "../src/stores/types";
import type { OutputItem } from "@flow-state-dev/core/items";

/** createExecutionContext.ts:513 — `flow.session?.historyWindow?.turns ?? 50`. */
const HISTORY_WINDOW = 50;

function makeCompleted(
  id: string,
  sessionId: string,
  startedAtMs: number,
  text: string
): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "send",
    userId: "u1",
    sessionId,
    status: "completed",
    startedAtMs,
    state: {},
    version: 0,
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    items: [
      {
        id: `${id}-i0`,
        requestId: id,
        type: "message",
        role: "assistant",
        text
      } as unknown as OutputItem
    ]
  } as RequestRecord;
}

/** Verbatim shape of the cross-turn history load at createExecutionContext.ts:526-536. */
function loadForegroundHistory(store: InMemoryRequestStore, sessionId: string) {
  return store.list({
    sessionId,
    tenantId: undefined,
    status: "completed",
    limit: HISTORY_WINDOW,
    orderBy: "startedAtMs",
    withItems: true
  });
}

describe("SPIKE: background work and cross-turn history", () => {
  it("MODEL A — a completed background sibling is indistinguishable from a user turn", async () => {
    const store = new InMemoryRequestStore();
    await store.set("req_fg1", makeCompleted("req_fg1", "sess_1", 1000, "user turn"), "any");
    await store.set(
      "req_bg1",
      makeCompleted("req_bg1", "sess_1", 2000, "BACKGROUND WORKER OUTPUT"),
      "any"
    );

    const history = await loadForegroundHistory(store, "sess_1");
    const texts = history.flatMap((r) =>
      (r.items ?? []).map((i) => (i as unknown as { text: string }).text)
    );

    // The background request is in the foreground LLM history.
    expect(texts).toContain("BACKGROUND WORKER OUTPUT");
    expect(history).toHaveLength(2);
  });

  it("MODEL A — RequestListOptions has no dimension that could exclude it", async () => {
    const store = new InMemoryRequestStore();
    await store.set("req_fg1", makeCompleted("req_fg1", "sess_1", 1000, "user turn"), "any");
    await store.set("req_bg1", makeCompleted("req_bg1", "sess_1", 2000, "bg"), "any");

    // Every filter the store exposes today. None separates foreground from background.
    const filtered = await store.list({
      flowKind: "chat",
      sessionId: "sess_1",
      tenantId: undefined,
      status: "completed",
      limit: HISTORY_WINDOW,
      orderBy: "startedAtMs",
      withItems: true
    });
    expect(filtered).toHaveLength(2);
  });

  it("MODEL A — N background turns evict real user turns from the window", async () => {
    const store = new InMemoryRequestStore();
    await store.set("req_fg_oldest", makeCompleted("req_fg_oldest", "sess_1", 1, "FIRST USER TURN"), "any");
    for (let i = 0; i < HISTORY_WINDOW; i++) {
      await store.set(
        `req_bg_${i}`,
        makeCompleted(`req_bg_${i}`, "sess_1", 100 + i, `bg ${i}`),
        "any"
      );
    }

    const history = await loadForegroundHistory(store, "sess_1");
    const ids = history.map((r) => r.id);

    // eslint-disable-next-line no-console
    console.log(
      `[spike] window=${HISTORY_WINDOW} returned=${history.length} ` +
        `oldest-user-turn-present=${ids.includes("req_fg_oldest")}`
    );

    expect(history).toHaveLength(HISTORY_WINDOW);
    // The claim §8 cites is the EVICTION, so assert it rather than only logging
    // it — otherwise a change to ordering or limit semantics could drop a
    // background turn instead and this POC would still pass while the spec kept
    // reporting the finding as established.
    expect(ids).not.toContain("req_fg_oldest");
    expect(ids.every((id) => id.startsWith("req_bg_"))).toBe(true);
  });

  it("MODEL B — a sub-session is excluded with zero query changes", async () => {
    const store = new InMemoryRequestStore();
    await store.set("req_fg1", makeCompleted("req_fg1", "sess_1", 1000, "user turn"), "any");
    // Same user, same tenant, same flow — only the session id differs.
    await store.set(
      "req_sub1",
      makeCompleted("req_sub1", "sess_1:sub_a", 2000, "SUB-SESSION WORKER OUTPUT"),
      "any"
    );

    const history = await loadForegroundHistory(store, "sess_1");
    const texts = history.flatMap((r) =>
      (r.items ?? []).map((i) => (i as unknown as { text: string }).text)
    );

    expect(texts).not.toContain("SUB-SESSION WORKER OUTPUT");
    expect(history).toHaveLength(1);
  });

  it("MODEL B — the sub-session keeps its own independent history", async () => {
    const store = new InMemoryRequestStore();
    await store.set("req_fg1", makeCompleted("req_fg1", "sess_1", 1000, "user turn"), "any");
    await store.set("req_sub1", makeCompleted("req_sub1", "sess_1:sub_a", 2000, "step 1"), "any");
    await store.set("req_sub2", makeCompleted("req_sub2", "sess_1:sub_a", 3000, "step 2"), "any");

    // The store returns most-recent-first; createExecutionContext.ts:543-545
    // re-sorts ascending before building history. Mirror that here.
    const asc = (rs: RequestRecord[]) =>
      [...rs].sort((a, b) => a.startedAtMs - b.startedAtMs).map((r) => r.id);

    // Follow-up work inside the sub-session sees its own prior turns — the
    // multi-turn container the sibling-request model has to invent.
    const subHistory = await loadForegroundHistory(store, "sess_1:sub_a");
    expect(asc(subHistory)).toEqual(["req_sub1", "req_sub2"]);

    // ...and the parent conversation is untouched.
    const parentHistory = await loadForegroundHistory(store, "sess_1");
    expect(asc(parentHistory)).toEqual(["req_fg1"]);
  });
});
