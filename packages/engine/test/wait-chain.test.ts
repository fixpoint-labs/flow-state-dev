/**
 * The depth of a chain of waits (FIX-2082): read live off the waits parked
 * now, from both ends, never copied at birth. Above the running request: what
 * waits on its own work, then on that waiter's. Below the work a new wait would
 * wait on: the deepest chain of waits under it. A request a waited dispatch
 * started counts its sender before the sender's park is written, from the
 * stamp the seam wrote, and the walk goes on from the sender's row.
 */
import { describe, expect, it } from "vitest";
import { MAX_WAIT_DEPTH } from "@flow-state-dev/core/types";
import { createRequestWaits, installWaits, outcomeOfRequest, waitChainDepth, waitedByOf } from "../src/durability/wait-chain";

type Parked = { requestId: string; data: Record<string, unknown> };

/** A provider holding `parked` wait gates for one user. */
function provider(parked: Parked[]) {
  return {
    listSuspended: async () =>
      parked.map((p) => ({ ...p, reason: "wait", status: "pending", suspensionId: `g-${p.requestId}`, userId: "u" })) as never
  };
}

const row = (taskId: string) => ({ board: "tasks", taskId });
/** A request parked on `taskId`, working `own`. */
const onTask = (requestId: string, taskId: string, own?: string): Parked => ({
  requestId,
  data: { ...row(taskId), deadline: 1, ...(own !== undefined ? { own: row(own) } : {}) }
});
/** A request parked on a request it dispatched, working `own`. */
const onRequest = (requestId: string, child: string, own?: string): Parked => ({
  requestId,
  data: { requestId: child, deadline: 1, ...(own !== undefined ? { own: row(own) } : {}) }
});

describe("the depth of a chain of waits", () => {
  it("counts the waits above the running request, through task rows and dispatched requests", async () => {
    // desk waits on t1; r1 works t1 and waits on its dispatch r2; r2 works nothing and waits on t3.
    const parked = [onTask("desk", "t1"), onRequest("r1", "r2", "t1")];
    // r2 is about to wait on t3, which nobody works below.
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r2", own: undefined }, row("t3"))).toBe(3);
  });

  it("counts the deepest chain below the work a new wait would wait on", async () => {
    // t1's request waits on t2, whose request waits on t3; a side branch under t1 is one deep.
    const parked = [onTask("w1", "t2", "t1"), onTask("w2", "t3", "t2"), onTask("side", "t9", "t1")];
    expect(await waitChainDepth(provider(parked), "u", { requestId: "desk", own: undefined }, row("t1"))).toBe(3);
  });

  it("refuses past the limit from either end: a late wait on a chain already five deep below", async () => {
    const parked = [onTask("a", "t2", "t1"), onTask("b", "t3", "t2"), onTask("c", "t4", "t3"), onTask("d", "t5", "t4"), onRequest("e", "probe", "t5")];
    expect(await waitChainDepth(provider(parked), "u", { requestId: "desk", own: undefined }, row("t1"))).toBe(MAX_WAIT_DEPTH + 1);
  });

  it("counts the sender of a waited dispatch before its park is written, and walks on from its row", async () => {
    // The sender d works t4; c waits on t4; b on t3 (c's own); d has not parked yet.
    const parked = [onTask("b", "t3"), onTask("c", "t4", "t3")];
    const running = { requestId: "probe", own: undefined };
    expect(await waitChainDepth(provider(parked), "u", running, undefined)).toBe(1);
    expect(await waitChainDepth(provider(parked), "u", running, undefined, { requestId: "d", own: row("t4") })).toBe(4);
    // Once the sender has parked, it is counted once, not twice.
    const withPark = [...parked, onRequest("d", "probe", "t4")];
    expect(await waitChainDepth(provider(withPark), "u", running, undefined, { requestId: "d", own: row("t4") })).toBe(4);
  });
});

describe("rows on two ledgers with the same task id", () => {
  // A task id is unique within its ledger only: "t1" on ledger A and on ledger B are two rows.
  const onLedger = (requestId: string, board: string, taskId: string, own?: { board: string; taskId: string }): Parked => ({
    requestId,
    data: { board, taskId, deadline: 1, ...(own !== undefined ? { own } : {}) }
  });

  it("a wait on one ledger's row is not a waiter on the other's", async () => {
    const parked = [onLedger("x", "ledger-b", "t1")];
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r", own: { board: "ledger-a", taskId: "t1" } }, undefined)).toBe(1);
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r", own: { board: "ledger-b", taskId: "t1" } }, undefined)).toBe(2);
  });

  it("the chain below a row counts only the waits whose request works that row", async () => {
    const parked = [onLedger("w", "ledger-b", "t2", { board: "ledger-b", taskId: "t1" })];
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r", own: undefined }, { board: "ledger-a", taskId: "t1" })).toBe(1);
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r", own: undefined }, { board: "ledger-b", taskId: "t1" })).toBe(2);
  });

  it("a row whose ledger isn't known matches by task id", async () => {
    // A request a task dispatch started knows its board, not its ledger.
    const parked = [onLedger("x", "ledger-b", "t1")];
    expect(await waitChainDepth(provider(parked), "u", { requestId: "r", own: { board: "", taskId: "t1" } }, undefined)).toBe(2);
  });
});

describe("a host's wait deadline bounds", () => {
  const host = () => ({ wakes: {} }) as { wakes: unknown; waits?: unknown };

  it("are refused unless finite: an infinite deadline is a wake that never comes due", () => {
    for (const settings of [{ defaultMs: Infinity, maxMs: Infinity }, { maxMs: Infinity }, { minMs: Number.NaN }]) {
      expect(() => installWaits(host() as never, {} as never, settings)).toThrow(/finite/);
    }
  });

  it("are taken when finite and ordered", () => {
    const requestHost = host();
    installWaits(requestHost as never, {} as never, { defaultMs: 2_000, minMs: 1_000, maxMs: 3_000 });
    expect((requestHost.waits as { deadlines: unknown }).deadlines).toEqual({ defaultMs: 2_000, minMs: 1_000, maxMs: 3_000 });
  });
});

describe("whether a request has stopped running its own work", () => {
  // The last gate on a request's log, as the sweep reads it to re-drive an interrupted request.
  const parkedOn = (gateId: string) => [{ type: "suspension", suspensionId: gateId }];
  const records: Record<string, { id: string; status: string; sessionId: string; items?: unknown[] }> = {
    done: { id: "done", status: "completed", sessionId: "s" },
    // Died while it ran, with no gate after: nothing drives it again.
    died: { id: "died", status: "interrupted", sessionId: "s" },
    // Died in the run after a resolved wait: the sweep re-drives it from that gate.
    redriven: { id: "redriven", status: "interrupted", sessionId: "s", items: parkedOn("g-wait") },
    // Died behind a gate still pending: its resume drives it.
    behindPending: { id: "behindPending", status: "interrupted", sessionId: "s", items: parkedOn("g-pending") },
    // Died behind an approval that expired with no reject allowed: nothing continues it.
    behindDeadGate: { id: "behindDeadGate", status: "interrupted", sessionId: "s", items: parkedOn("g-form") },
    parked: { id: "parked", status: "suspended", sessionId: "s" },
    running: { id: "running", status: "in_progress", sessionId: "s" },
    elsewhere: { id: "elsewhere", status: "completed", sessionId: "s_other" }
  };
  const gates: Record<string, unknown> = {
    "g-wait": { suspensionId: "g-wait", reason: "wait", status: "submitted", allow: ["submit"] },
    "g-pending": { suspensionId: "g-pending", reason: "approval", status: "pending", allow: ["approve", "reject"] },
    "g-form": { suspensionId: "g-form", reason: "input", status: "expired", allow: ["submit"] }
  };
  const waits = createRequestWaits({
    provider: { ...provider([]), loadSuspension: async (_requestId: string, gateId: string) => (gates[gateId] ?? null) as never },
    deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
    userId: "u",
    requestId: "r",
    own: undefined,
    sessionId: "s",
    readRequest: async (id) => records[id] as never
  });

  it("is true for an end, and for an interruption nothing will drive again", async () => {
    expect(await waits.ended!(["done", "died", "behindDeadGate", "gone"])).toEqual({
      done: true,
      died: true,
      behindDeadGate: true,
      gone: true
    });
  });

  it("answers false for a request whose record or gate can't be read, and still answers the others", async () => {
    const failing = createRequestWaits({
      provider: {
        ...provider([]),
        loadSuspension: async () => {
          throw new Error("store unavailable");
        }
      },
      deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
      userId: "u",
      requestId: "r",
      own: undefined,
      sessionId: "s",
      readRequest: async (id) => {
        if (id === "unreadable") throw new Error("store unavailable");
        return records[id] as never;
      }
    });
    expect(await failing.ended!(["redriven", "unreadable", "done", "died"])).toEqual({
      redriven: false,
      unreadable: false,
      done: true,
      died: true
    });
  });

  it("is false for an interruption the sweep re-drives or a resume drives, while it runs or is parked, and for another session", async () => {
    expect(await waits.ended!(["redriven", "behindPending", "parked", "running", "elsewhere"])).toEqual({
      redriven: false,
      behindPending: false,
      parked: false,
      running: false,
      elsewhere: false
    });
  });

  it("tells running apart from parked: only a request in progress in this session is running", async () => {
    const elsewhereRunning = { id: "elsewhereRunning", status: "in_progress", sessionId: "s_other" };
    const both = createRequestWaits({
      provider: { ...provider([]), loadSuspension: async () => null as never },
      deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
      userId: "u",
      requestId: "r",
      own: undefined,
      sessionId: "s",
      readRequest: async (id) => {
        if (id === "unreadable") throw new Error("store unavailable");
        return (id === "elsewhereRunning" ? elsewhereRunning : records[id]) as never;
      }
    });
    expect(await both.running!(["running", "parked", "done", "died", "redriven", "gone", "elsewhereRunning", "unreadable"])).toEqual({
      running: true,
      parked: false,
      done: false,
      died: false,
      redriven: false,
      gone: false,
      elsewhereRunning: false,
      unreadable: false
    });
  });

  describe("a request whose process died before the sweep marked it (FIX-2166)", () => {
    // Its record still reads `in_progress`; only its heartbeat stopped.
    const NOW = 1_000_000;
    const THRESHOLD = 60_000;
    const inProgress = (id: string) => ({ id, status: "in_progress", sessionId: "s" });
    const entries: Record<string, { lastHeartbeatAt: number; queuedAt?: number }> = {
      beating: { lastHeartbeatAt: NOW - 10_000 },
      // Last beat just inside the threshold: a request on a live peer, between beats.
      atThreshold: { lastHeartbeatAt: NOW - THRESHOLD },
      stopped: { lastHeartbeatAt: NOW - THRESHOLD - 1 },
      // Queued for an external worker: nothing beats for it yet, and it is not dead.
      queued: { lastHeartbeatAt: NOW - 10 * THRESHOLD, queuedAt: NOW - 10 * THRESHOLD },
      // A custom registry that records no heartbeat: no proof of anything.
      noHeartbeat: {} as { lastHeartbeatAt: number }
    };
    const waitsWith = (heartbeat?: { staleThresholdMs: number }) =>
      createRequestWaits({
        provider: { ...provider([]), loadSuspension: async () => null as never },
        deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
        userId: "u",
        requestId: "r",
        own: undefined,
        sessionId: "s",
        readRequest: async (id) => inProgress(id) as never,
        ...(heartbeat !== undefined
          ? { heartbeat: { readEntry: async (id) => entries[id], staleThresholdMs: heartbeat.staleThresholdMs, now: () => NOW } }
          : {})
      });

    it("reads it as stopped once its heartbeat is stale past the sweep's threshold, and no sooner", async () => {
      // A notice held for it is sent then, rather than when the sweep gets to it.
      expect(await waitsWith({ staleThresholdMs: THRESHOLD }).running!(["beating", "atThreshold", "stopped", "queued", "noHeartbeat", "unregistered"])).toEqual({
        beating: true,
        atThreshold: true,
        stopped: false,
        queued: true,
        noHeartbeat: true,
        // No entry is no proof its process is gone: the record answers.
        unregistered: true
      });
    });

    it("reads the record alone when the registry can't be read: a lookup that fails is no proof its process is gone", async () => {
      // Read as stopped, a live request would have its notice sent and its
      // lapsed slots released while it still runs.
      const blip = createRequestWaits({
        provider: { ...provider([]), loadSuspension: async () => null as never },
        deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
        userId: "u",
        requestId: "r",
        own: undefined,
        sessionId: "s",
        readRequest: async (id) => inProgress(id) as never,
        heartbeat: {
          readEntry: async () => Promise.reject(new Error("registry unavailable")),
          staleThresholdMs: THRESHOLD,
          now: () => NOW
        }
      });
      expect(await blip.running!(["live"])).toEqual({ live: true });
    });

    it("reads the record alone where heartbeats can't say: a stale entry there is a healthy request", async () => {
      // A flow with heartbeats off never beats, so every entry of it looks stale.
      expect(await waitsWith().running!(["stopped"])).toEqual({ stopped: true });
    });
  });
});

describe("the stamp a waited dispatch leaves on its child", () => {
  const stamp = (waitedBy: unknown) => ({
    dispatch: { type: "internal", action: "probe", from: { block: "b", sessionId: "s" }, waitedBy }
  });

  it("is read only off a request the runtime dispatched", () => {
    expect(waitedByOf("internal", stamp({ requestId: "d", own: row("t4") }))).toEqual({ requestId: "d", own: row("t4") });
    expect(waitedByOf("internal", stamp({ requestId: "d" }))).toEqual({ requestId: "d" });
    // A caller's own bag over HTTP is not a stamp.
    expect(waitedByOf("http", stamp({ requestId: "d" }))).toBeUndefined();
    expect(waitedByOf("internal", stamp({ requestId: 4 }))).toBeUndefined();
  });
});

describe("how a waited-on request's end resumes its waiter", () => {
  it("answers with its output, an error naming its end, or nothing while it runs", () => {
    expect(outcomeOfRequest({ status: "completed", result: { output: "done" } } as never)).toEqual({ answered: true, answer: "done" });
    expect(outcomeOfRequest({ status: "aborted" } as never)).toMatchObject({ answered: false, error: { code: "wait_task_cancelled" } });
    expect(outcomeOfRequest({ status: "failed", result: { error: { message: "boom" } } } as never)).toMatchObject({
      answered: false,
      error: { code: "wait_task_failed", message: "boom" }
    });
    expect(outcomeOfRequest({ status: "in_progress" } as never)).toBeUndefined();
  });
});
