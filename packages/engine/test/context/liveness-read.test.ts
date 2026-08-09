/**
 * The liveness read (FIX-999).
 *
 * Two things this file pins that are easy to get wrong:
 *
 * **1. The backing read is `get()` per supplied id — never `listStale()`.**
 * `listStale(threshold)` returns *registered* entries older than the cutoff, and
 * a terminal request is **deregistered**. So a completed request and a
 * freshly-registered healthy one are BOTH absent from the stale set, and neither
 * reading of that set answers the question: complementing it reports finished
 * work as **alive** (the answer that causes double execution), and treating
 * membership as alive reports healthy work as **dead**. `listAll()` is rejected
 * separately — it enumerates across tenants.
 *
 * **2. A nonzero sweep cadence is not enough.** If the cadence is much larger
 * than the stale threshold, a worker that crashed just after a sweep stays
 * registered until the next tick and a plain `get()` reports it alive for that
 * whole window — blocking reconciliation and holding ceiling capacity for a dead
 * request. The read compares `lastHeartbeatAt` itself, which is correct however
 * the cadence is tuned.
 *
 * And the semantics the answer carries: `false` means "no live registration was
 * found", never "definitely dead."
 */
import { describe, it, expect, vi } from "vitest";
import { readLiveness } from "../../src/context/liveness-read";
import type { ActiveRequestEntry } from "../../src/stores/types";

const NOW = 1_000_000;
const THRESHOLD = 60_000;

function entry(over: Partial<ActiveRequestEntry> = {}): ActiveRequestEntry {
  return {
    requestId: "req_1",
    flowKind: "board",
    actionName: "drain",
    sessionId: "s_child",
    userId: "u_alice",
    tenantId: "t_acme",
    source: "workstream",
    startedAt: NOW - 10_000,
    lastHeartbeatAt: NOW - 1_000,
    ...over
  };
}

function harness(entries: Record<string, ActiveRequestEntry | undefined>) {
  const get = vi.fn(async (id: string) => entries[id]);
  const listAll = vi.fn(async () => Object.values(entries) as ActiveRequestEntry[]);
  const listStale = vi.fn(async () => [] as ActiveRequestEntry[]);
  return {
    registry: { get, listAll, listStale },
    get,
    listAll,
    listStale,
    inputs: {
      staleThresholdMs: THRESHOLD,
      principal: { userId: "u_alice", tenantId: "t_acme" },
      isDescendantSession: async (sessionId: string | undefined) => sessionId === "s_child",
      now: () => NOW
    }
  };
}

describe("liveness read", () => {
  it("reports a fresh, owned, descendant request as live", async () => {
    const h = harness({ req_1: entry() });
    const answers = await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_1: true });
  });

  it("reports a completed (deregistered) request as NOT live", async () => {
    const h = harness({ req_gone: undefined });
    const answers = await readLiveness(["req_gone"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_gone: false });
  });

  it("distinguishes a completed request from a live one — the answer listStale cannot give", async () => {
    // Both are absent from the stale set, so a stale-set-backed implementation
    // reports them identically. This is the whole reason the backing read is
    // `get()`, and the wrong answer here is the one that ships double execution.
    const h = harness({ req_live: entry({ requestId: "req_live" }), req_done: undefined });
    const answers = await readLiveness(["req_live", "req_done"], {
      ...h.inputs,
      registry: h.registry
    });
    expect(answers).toEqual({ req_live: true, req_done: false });
  });

  it("never enumerates: reads are bounded by the caller's id set", async () => {
    const h = harness({ req_1: entry(), req_2: entry({ requestId: "req_2" }) });
    await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(h.listAll).not.toHaveBeenCalled();
    expect(h.listStale).not.toHaveBeenCalled();
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get).toHaveBeenCalledWith("req_1");
  });

  it("treats a registered entry past the stale threshold as NOT live", async () => {
    // Requirement 2: a crashed worker whose entry the sweeper has not reached
    // yet. A plain `get()` would report it alive for a whole sweep interval.
    const h = harness({ req_1: entry({ lastHeartbeatAt: NOW - (THRESHOLD + 1) }) });
    const answers = await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_1: false });
  });

  it("keeps an entry exactly at the threshold live — the boundary is not stale yet", async () => {
    const h = harness({ req_1: entry({ lastHeartbeatAt: NOW - THRESHOLD }) });
    const answers = await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_1: true });
  });

  it("answers not-live for another principal's request, indistinguishably from an unknown id", async () => {
    const h = harness({ req_theirs: entry({ requestId: "req_theirs", userId: "u_bob" }) });
    const answers = await readLiveness(["req_theirs", "req_nonexistent"], {
      ...h.inputs,
      registry: h.registry
    });
    // No existence oracle: the caller cannot tell that req_theirs exists at all.
    expect(answers).toEqual({ req_theirs: false, req_nonexistent: false });
  });

  it("answers not-live across a tenant boundary", async () => {
    const h = harness({ req_1: entry({ tenantId: "t_other" }) });
    const answers = await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_1: false });
  });

  it("answers not-live for a request outside the caller's descendant chain", async () => {
    const h = harness({ req_1: entry({ sessionId: "s_unrelated" }) });
    const answers = await readLiveness(["req_1"], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({ req_1: false });
  });

  it("answers for every id it was given, including duplicates, and nothing else", async () => {
    const h = harness({ req_1: entry() });
    const answers = await readLiveness(["req_1", "req_1", "req_x"], {
      ...h.inputs,
      registry: h.registry
    });
    expect(Object.keys(answers).sort()).toEqual(["req_1", "req_x"]);
  });

  it("returns an empty answer set for an empty batch without touching the registry", async () => {
    const h = harness({ req_1: entry() });
    const answers = await readLiveness([], { ...h.inputs, registry: h.registry });
    expect(answers).toEqual({});
    expect(h.get).not.toHaveBeenCalled();
  });
});
