/**
 * A wait on a request of the waiter's own session (FIX-2239): a message queued
 * behind a request stopped for a person parks on that request, which nobody
 * dispatched. The engine resumes it when that request ends, from the run that
 * resumed the request (the person answered, stopped it, or let it expire).
 *
 * Why it matters: without the own-session look, the queued message waits out
 * its deadline after the person answers. And the look must cost nothing on a
 * request that never parked: every plain request end stays one record read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resumed: Array<{ requestId: string; suspensionId: string; resumedBy: string }> = [];
vi.mock("../src/durability/resume-wait-gate", () => ({
  resumeWaitGate: async (_deps: unknown, gate: { requestId: string; suspensionId: string }, _outcome: unknown, resumedBy: string) => {
    resumed.push({ requestId: gate.requestId, suspensionId: gate.suspensionId, resumedBy });
    return { ok: true };
  }
}));

const { createRequestWaits, resumeRequestWaiters } = await import("../src/durability/wait-chain");

type Gate = { requestId: string; sessionId: string; suspensionId: string; reason: string; data?: Record<string, unknown> };

/** A provider holding `gates`, filtered by session as the store filters, counting each listing. */
function provider(gates: Gate[]) {
  const listings: Array<{ sessionId?: string }> = [];
  return {
    listings,
    listSuspended: async (filter: { sessionId?: string }) => {
      listings.push(filter);
      return gates
        .filter((g) => filter.sessionId === undefined || g.sessionId === filter.sessionId)
        .map((g) => ({ ...g, status: "pending", userId: "u" })) as never;
    },
    loadSuspension: async () => null as never
  };
}

/** A request of session `s1` that nobody dispatched (a person's own turn), ended. */
const stoppedTurn = { id: "r_stopped", status: "completed", result: { output: "done" }, source: "http", metadata: {}, userId: "u", sessionId: "s1" } as const;

/** A message in `s1` queued behind `r_stopped`. */
const queued: Gate = { requestId: "r_msg", sessionId: "s1", suspensionId: "queue:msg_1#a", reason: "wait", data: { requestId: "r_stopped", deadline: 1 } };

beforeEach(() => {
  resumed.length = 0;
});

describe("a request's end resumes what its own session queued behind it", () => {
  it("resumes the gate bound to it in its own session, when the run that ended it resumed it", async () => {
    const p = provider([queued]);
    await resumeRequestWaiters({ provider: p } as never, stoppedTurn as never, { ownSession: true });
    expect(resumed).toEqual([{ requestId: "r_msg", suspensionId: "queue:msg_1#a", resumedBy: "request:r_stopped" }]);
  });

  it("lists nothing for a request that never parked and nobody dispatched: a plain end costs what it did", async () => {
    const p = provider([queued]);
    await resumeRequestWaiters({ provider: p } as never, stoppedTurn as never, { ownSession: false });
    await resumeRequestWaiters({ provider: p } as never, stoppedTurn as never);
    expect(p.listings).toEqual([]);
    expect(resumed).toEqual([]);
  });

  it("leaves a gate bound to another request alone, and a request still running resumes nothing", async () => {
    const other: Gate = { ...queued, suspensionId: "queue:msg_2#b", data: { requestId: "r_other", deadline: 1 } };
    const p = provider([other]);
    await resumeRequestWaiters({ provider: p } as never, stoppedTurn as never, { ownSession: true });
    await resumeRequestWaiters({ provider: provider([queued]) } as never, { ...stoppedTurn, status: "suspended" } as never, { ownSession: true });
    expect(resumed).toEqual([]);
  });
});

describe("a session's open stop for a person", () => {
  const waits = (gates: Gate[], requestId = "r_msg") =>
    createRequestWaits({
      provider: provider(gates),
      deadlines: { defaultMs: 1, minMs: 1, maxMs: 1 },
      userId: "u",
      requestId,
      own: undefined,
      sessionId: "s1",
      readRequest: async () => undefined
    });

  it("is the request parked on a person, and never a wait, another session's stop, or the asking request's own", async () => {
    const person: Gate = { requestId: "r_stopped", sessionId: "s1", suspensionId: "ask", reason: "user_input" };
    expect(await waits([queued, person]).userStop!()).toEqual({ requestId: "r_stopped" });
    // A wait parked in the session is no person's stop: a queued message never holds another.
    expect(await waits([queued]).userStop!()).toBeUndefined();
    expect(await waits([{ ...person, sessionId: "s2" }]).userStop!()).toBeUndefined();
    expect(await waits([person], "r_stopped").userStop!()).toBeUndefined();
  });
});
