/**
 * The arbiter over an ordered-lease backend, standing in for several processes.
 *
 * Two arbiters built over ONE backend are two processes that share a place to
 * line up: neither holds the other's state, so the only thing that can make
 * them agree about a key is the backend. Each policy is asserted across that
 * boundary, once over the in-memory backend itself and once over a plain
 * four-call wrapper of it — the shape any adapter-supplied backend has, with no
 * synchronous admission and no in-process wake.
 *
 * The wait step (`planQueueWait`) is asserted directly: it is the engine's one
 * answer to "not my turn, now what?", which an adapter's worker imports rather
 * than re-deriving.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createConcurrencyArbiter,
  isPendingAdmission,
  type ConcurrencyAdmission,
  type ConcurrencyFlowView
} from "../../../src/transports/concurrency/arbiter";
import { admitAndRun } from "./admit-and-run";
import {
  createInMemoryLeaseBackend,
  DEFER_PATIENCE_MS,
  planDeferWait,
  planQueueWait,
  type ConcurrencyLeaseBackend
} from "../../../src/transports/concurrency/lease-backend";
import {
  ConcurrencyQueueTimeoutError,
  ConcurrencyRejectedError
} from "../../../src/transports/errors";
import type { DispatchEnvelope } from "../../../src/transports/dispatcher";

function envelope(requestId: string): DispatchEnvelope {
  return {
    requestId,
    flowKind: "chat",
    actionName: "respond",
    input: {},
    userId: "u_1",
    orgId: "org_1",
    sessionId: "s_1"
  };
}

const rejectFlow: ConcurrencyFlowView = { actions: { respond: { concurrency: "reject" } } };
const queueFlow: ConcurrencyFlowView = { actions: { respond: { concurrency: "queue" } } };

/**
 * The backend as an adapter would supply it: only the four public calls, each
 * answered asynchronously. Wrapping hides the in-memory backend's synchronous
 * fast path, so the arbiter must take the generic route.
 */
function fourCallBackend(inner: ConcurrencyLeaseBackend = createInMemoryLeaseBackend()) {
  const calls: string[] = [];
  const backend: ConcurrencyLeaseBackend = {
    take: async (input) => {
      calls.push(`take:${input.requestId}${input.ifEmpty === true ? ":ifEmpty" : ""}`);
      return inner.take(input);
    },
    isMyTurn: async (place) => inner.isMyTurn(place),
    giveBack: async (place) => {
      calls.push(`giveBack:${place.ticket}`);
      return inner.giveBack(place);
    },
    renew: async (place) => inner.renew(place)
  };
  return { backend, calls, inner };
}

/** Run `n` dispatches through alternating arbiters and record their windows. */
async function serializeAcross(
  arbiters: ReturnType<typeof createConcurrencyArbiter>[],
  n: number
): Promise<{ order: number[]; maxActive: number }> {
  const order: number[] = [];
  let active = 0;
  let maxActive = 0;
  const runs = Array.from({ length: n }, (_, i) => {
    const arbiter = arbiters[i % arbiters.length]!;
    const d = arbiter.resolve(queueFlow, "respond", envelope(`req_${i}`));
    return admitAndRun(arbiter, d, `req_${i}`)(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(i);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
  });
  await Promise.all(runs);
  return { order, maxActive };
}

describe("two arbiters over one in-memory backend", () => {
  it("refuses a `reject` in the second while the first holds the key, naming the holder", async () => {
    const backend = createInMemoryLeaseBackend();
    const a = createConcurrencyArbiter({ backend });
    const b = createConcurrencyArbiter({ backend });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = admitAndRun(a, a.resolve(rejectFlow, "respond", envelope("req_a")), "req_a")(() => held);

    const d = b.resolve(rejectFlow, "respond", envelope("req_b"));
    let refused: unknown;
    try {
      admitAndRun(b, d, "req_b");
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(ConcurrencyRejectedError);
    expect((refused as ConcurrencyRejectedError).inFlightRequestId).toBe("req_a");

    release();
    await first;
    expect(() => admitAndRun(b, b.resolve(rejectFlow, "respond", envelope("req_c")), "req_c")).not.toThrow();
  });

  it("serializes `queue` runs across both, in the order their places were taken", async () => {
    const backend = createInMemoryLeaseBackend();
    const result = await serializeAcross(
      [createConcurrencyArbiter({ backend }), createConcurrencyArbiter({ backend })],
      4
    );
    expect(result.maxActive).toBe(1);
    expect(result.order).toEqual([0, 1, 2, 3]);
  });

  it("does not arbitrate across two arbiters that each hold their own backend", async () => {
    // The control: what two processes with a lock each look like. If this ever
    // serializes, the shared-backend case above proves nothing.
    const result = await serializeAcross([createConcurrencyArbiter(), createConcurrencyArbiter()], 2);
    expect(result.maxActive).toBe(2);
  });
});

describe("two arbiters over an adapter-shaped (four-call) backend", () => {
  it("refuses a `reject` asynchronously, naming the holder, and never runs the loser", async () => {
    const { backend } = fourCallBackend();
    const a = createConcurrencyArbiter({ backend });
    const b = createConcurrencyArbiter({ backend });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = admitAndRun(a, a.resolve(rejectFlow, "respond", envelope("req_a")), "req_a")(() => held);
    await new Promise((r) => setTimeout(r, 1));

    let loserRan = false;
    const second = admitAndRun(b, b.resolve(rejectFlow, "respond", envelope("req_b")), "req_b")(async () => {
      loserRan = true;
    });
    await expect(second).rejects.toBeInstanceOf(ConcurrencyRejectedError);
    await second.catch((e: ConcurrencyRejectedError) => {
      expect(e.inFlightRequestId).toBe("req_a");
    });
    expect(loserRan).toBe(false);

    release();
    await first;
  });

  it("serializes `queue` runs across both and gives every place back", async () => {
    const { backend, calls } = fourCallBackend();
    const result = await serializeAcross(
      [createConcurrencyArbiter({ backend }), createConcurrencyArbiter({ backend })],
      3
    );
    expect(result.maxActive).toBe(1);
    expect(result.order).toEqual([0, 1, 2]);
    expect(calls.filter((c) => c.startsWith("giveBack:"))).toHaveLength(3);
  });

  it("fails closed: an unreachable backend refuses the run rather than running it unarbitrated", async () => {
    const down = new Error("lease backend unreachable");
    const backend: ConcurrencyLeaseBackend = {
      take: async () => {
        throw down;
      },
      isMyTurn: async () => true,
      giveBack: async () => {},
      renew: async () => {}
    };
    const arbiter = createConcurrencyArbiter({ backend });
    let ran = false;
    const run = admitAndRun(arbiter, arbiter.resolve(queueFlow, "respond", envelope("req_1")), "req_1")(
      async () => {
        ran = true;
      }
    );
    await expect(run).rejects.toBe(down);
    expect(ran).toBe(false);
  });

  it("takes no place for `allow`", async () => {
    const { backend, calls } = fourCallBackend();
    const arbiter = createConcurrencyArbiter({ backend });
    const d = arbiter.resolve({ actions: {} }, "respond", envelope("req_1"));
    await admitAndRun(arbiter, d, "req_1")(async () => undefined);
    expect(calls).toEqual([]);
  });
});

describe("a place the arbiter runs over a shared backend", () => {
  it("a holder running longer than the lease is still renewed, and only until it gives the place back", async () => {
    // A run the arbiter starts in this process (a web process's HTTP run, say)
    // holds its place for as long as the run takes. On a backend whose places
    // expire, a place nobody renews lapses mid-run and a worker's run on the
    // same session starts alongside it.
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const renewed: string[] = [];
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        renew: async (place) => {
          renewed.push(place.ticket);
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const admission = await arbiter.admit(
        arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
        "req_1"
      );
      const run = admission.run(() => held);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(renewed.length).toBeGreaterThanOrEqual(3);

      release();
      await run;
      const atGiveBack = renewed.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(renewed.length).toBe(atGiveBack);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report the run settled until its place is given back", async () => {
    // A caller that sees the run settle and dispatches again on the same key
    // (a chat's next turn) must not be refused by the place of the run it just
    // watched finish. A give-back is a round trip on a shared backend.
    const { backend: shaped, inner } = fourCallBackend();
    let finishGiveBack!: () => void;
    const giveBackLanded = new Promise<void>((r) => (finishGiveBack = r));
    const backend: ConcurrencyLeaseBackend = {
      ...shaped,
      giveBack: async (place) => {
        await giveBackLanded;
        return inner.giveBack(place);
      }
    };
    const arbiter = createConcurrencyArbiter({ backend });
    const admission = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
      "req_1"
    );
    let settled = false;
    const run = admission.run(async () => "done").then((v) => {
      settled = true;
      return v;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    finishGiveBack();
    await expect(run).resolves.toBe("done");
    await expect(inner.take({ key: "s_1", requestId: "req_2", ifEmpty: true })).resolves.toHaveProperty(
      "place"
    );
  });

  it("keeps the run's own outcome when the give-back fails, and says so in the log", async () => {
    const { backend: shaped } = fourCallBackend();
    const backend: ConcurrencyLeaseBackend = {
      ...shaped,
      giveBack: async () => {
        throw new Error("backend unreachable");
      }
    };
    const warn = vi.fn();
    const arbiter = createConcurrencyArbiter({ backend, logger: { warn } });
    const admission = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
      "req_1"
    );

    await expect(admission.run(async () => "done")).resolves.toBe("done");
    await expect(
      (
        await arbiter.admit(
          arbiter.resolve(rejectFlow, "respond", { ...envelope("req_2"), sessionId: "s_2" }),
          "req_2"
        )
      ).run(
        async () => {
          throw new Error("run failed");
        }
      )
    ).rejects.toThrow("run failed");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![1]).toMatchObject({ key: "s_1", error: "backend unreachable" });
  });
});

describe("a place this process holds on a shared backend, before it runs", () => {
  it("is renewed from the moment it is taken until it is handed to a job", async () => {
    // Between the take and the run (the dispatch's record writes, a slow
    // enqueue) the place is this process's, and nobody else renews it.
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const renewed: string[] = [];
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        renew: async (place) => {
          renewed.push(place.ticket);
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const admission = await arbiter.admit(
        arbiter.resolve(queueFlow, "respond", envelope("req_1")),
        "req_1"
      );

      await vi.advanceTimersByTimeAsync(10_000);
      expect(renewed.length).toBeGreaterThanOrEqual(3);

      admission.handOff(new Promise(() => {}));
      const atHandOff = renewed.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(renewed.length).toBe(atHandOff);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a queued wait on a shared backend", () => {
  it("does not accept a turn that comes after the wait budget", async () => {
    // The turn arrives only once the budget has run out, as when the last
    // re-check lands at the budget's end or `isMyTurn` itself runs past it.
    // The documented outcome is a timeout, not a run started late.
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const start = Date.now();
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        isMyTurn: async () => Date.now() - start >= 30_000
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const waiter = await arbiter.admit(
        arbiter.resolve(queueFlow, "respond", envelope("req_1")),
        "req_1"
      );
      let started = false;
      const waited = waiter.run(async () => {
        started = true;
      });
      waited.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(35_000);
      await expect(waited).rejects.toBeInstanceOf(ConcurrencyQueueTimeoutError);
      expect(started).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a backend call that throws synchronously", () => {
  it("does not escape a give-back: the run keeps its outcome, release resolves, and it is logged", async () => {
    const { backend: shaped } = fourCallBackend();
    const backend: ConcurrencyLeaseBackend = {
      ...shaped,
      giveBack: () => {
        throw new Error("connection closed");
      }
    };
    const warn = vi.fn();
    const arbiter = createConcurrencyArbiter({ backend, logger: { warn } });

    const ran = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
      "req_1"
    );
    await expect(ran.run(async () => "done")).resolves.toBe("done");

    const unrun = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", { ...envelope("req_2"), sessionId: "s_2" }),
      "req_2"
    );
    await expect(unrun.release()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not escape a give-back whose log call throws either", async () => {
    // The diagnostic is best effort too: a logger that throws must not turn
    // a failed give-back into the run's failure, or into a rejected release.
    const { backend: shaped } = fourCallBackend();
    const backend: ConcurrencyLeaseBackend = {
      ...shaped,
      giveBack: async () => {
        throw new Error("backend unreachable");
      }
    };
    const warn = vi.fn(() => {
      throw new Error("log sink closed");
    });
    const arbiter = createConcurrencyArbiter({ backend, logger: { warn } });

    const ran = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
      "req_1"
    );
    await expect(ran.run(async () => "done")).resolves.toBe("done");

    const unrun = await arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", { ...envelope("req_2"), sessionId: "s_2" }),
      "req_2"
    );
    await expect(unrun.release()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not escape the renewal timer", async () => {
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        renew: () => {
          throw new Error("connection closed");
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const admission = await arbiter.admit(
        arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
        "req_1"
      );
      let release!: () => void;
      const run = admission.run(() => new Promise<string>((r) => (release = () => r("done"))));
      await vi.advanceTimersByTimeAsync(10_000);
      release();
      await expect(run).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("whether an arbiter arbitrates across processes", () => {
  it("is true only when a backend was supplied", () => {
    expect(createConcurrencyArbiter().arbitratesAcrossProcesses).toBe(false);
    expect(
      createConcurrencyArbiter({ backend: createInMemoryLeaseBackend() }).arbitratesAcrossProcesses
    ).toBe(true);
  });
});

describe("planQueueWait — the engine's answer to 'not my turn yet'", () => {
  it("waits with a delay that never runs past the wait budget", () => {
    const step = planQueueWait({ key: "k", waitedMs: 29_990, attempt: 20, random: () => 1 });
    expect(step).toEqual({ kind: "wait", delayMs: 10 });
  });

  it("times out once the budget is spent, with the in-process error", () => {
    const step = planQueueWait({ key: "k", waitedMs: 30_000, attempt: 3 });
    expect(step.kind).toBe("timeout");
    if (step.kind === "timeout") {
      expect(step.error).toBeInstanceOf(ConcurrencyQueueTimeoutError);
      expect(step.error.key).toBe("k");
    }
  });

  it("backs off as attempts grow, up to a cap of a few seconds", () => {
    const at = (attempt: number) =>
      planQueueWait({ key: "k", waitedMs: 0, attempt, random: () => 1 });
    const first = at(0);
    const later = at(4);
    const capped = at(50);
    expect(first.kind === "wait" && later.kind === "wait" && capped.kind === "wait").toBe(true);
    if (first.kind === "wait" && later.kind === "wait" && capped.kind === "wait") {
      expect(later.delayMs).toBeGreaterThan(first.delayMs);
      expect(capped.delayMs).toBeLessThanOrEqual(5_000);
    }
  });

  it("spreads waiters with jitter rather than waking them together", () => {
    const low = planQueueWait({ key: "k", waitedMs: 0, attempt: 4, random: () => 0 });
    const high = planQueueWait({ key: "k", waitedMs: 0, attempt: 4, random: () => 1 });
    expect(low.kind === "wait" && high.kind === "wait").toBe(true);
    if (low.kind === "wait" && high.kind === "wait") {
      expect(low.delayMs).toBeLessThan(high.delayMs);
      expect(low.delayMs).toBeGreaterThan(0);
    }
  });

  it("never times out a wait with no budget", () => {
    const step = planQueueWait({ key: "k", waitedMs: 10 * 60_000, attempt: 40, budgetMs: Infinity, random: () => 1 });
    expect(step).toEqual({ kind: "wait", delayMs: 2_000 });
  });
});

describe("planDeferWait — the engine's answer to 'the key is not free yet'", () => {
  it("keeps trying to claim the key until its patience is spent, then lines up", () => {
    expect(planDeferWait({ waitedMs: DEFER_PATIENCE_MS - 1, attempt: 0 }).kind).toBe("claim-if-free");
    expect(planDeferWait({ waitedMs: DEFER_PATIENCE_MS, attempt: 0 })).toEqual({ kind: "line-up" });
    expect(planDeferWait({ waitedMs: 1_000, attempt: 0, patienceMs: 1_000 })).toEqual({ kind: "line-up" });
  });

  it("never sleeps past its patience, so the line-up lands on time", () => {
    const step = planDeferWait({ waitedMs: DEFER_PATIENCE_MS - 300, attempt: 20, random: () => 1 });
    expect(step).toEqual({ kind: "claim-if-free", retryInMs: 300, patienceLeftMs: 300 });
  });

  it("backs off like a queued wait, capped at two seconds", () => {
    const step = planDeferWait({ waitedMs: 0, attempt: 20, random: () => 1 });
    expect(step).toEqual({ kind: "claim-if-free", retryInMs: 2_000, patienceLeftMs: DEFER_PATIENCE_MS });
  });
});

describe("the in-memory backend's four calls", () => {
  it("orders places, claims only a free key with ifEmpty, and moves the turn on give-back", async () => {
    const backend = createInMemoryLeaseBackend();
    const first = await backend.take({ key: "k", requestId: "r1" });
    const second = await backend.take({ key: "k", requestId: "r2" });
    expect("place" in first && "place" in second).toBe(true);
    if (!("place" in first) || !("place" in second)) return;

    expect(await backend.take({ key: "k", requestId: "r3", ifEmpty: true })).toEqual({ heldBy: "r1" });
    expect(await backend.isMyTurn(first.place)).toBe(true);
    expect(await backend.isMyTurn(second.place)).toBe(false);

    await backend.giveBack(first.place);
    await backend.giveBack(first.place); // idempotent
    expect(await backend.isMyTurn(second.place)).toBe(true);

    await backend.giveBack(second.place);
    expect("place" in (await backend.take({ key: "k", requestId: "r4", ifEmpty: true }))).toBe(true);
  });
});

describe("a waiting place the backend no longer has", () => {
  it("is reported missing by the in-memory backend, not merely as not its turn", async () => {
    const backend = createInMemoryLeaseBackend();
    const first = await backend.take({ key: "k", requestId: "r1" });
    const second = await backend.take({ key: "k", requestId: "r2" });
    if (!("place" in first) || !("place" in second)) throw new Error("expected places");
    expect(await backend.isMyTurn(second.place)).toBe(false);
    await backend.giveBack(second.place);
    expect(await backend.isMyTurn(second.place)).toBe("missing");
  });

  it("is re-admitted at the back of the line and still runs", async () => {
    // A shared backend drops a place whose lease ran out. The request behind
    // it did not go away, so it lines up again behind whoever arrived since,
    // rather than waiting forever on a place that will never be first.
    const { backend, inner } = fourCallBackend();
    const arbiter = createConcurrencyArbiter({ backend });
    const admit = (id: string) =>
      arbiter.admit(arbiter.resolve(queueFlow, "respond", envelope(id)), id) as Promise<ConcurrencyAdmission>;
    const order: string[] = [];
    let releaseA!: () => void;
    const a = await admit("req_a");
    const runA = a.run(async () => {
      await new Promise<void>((r) => (releaseA = r));
      order.push("a");
    });
    const b = await admit("req_b");
    const bFirstPlace = b.place!;
    const runB = b.run(async () => {
      order.push("b");
    });
    // B has checked its turn once and is sleeping before the next check.
    await new Promise((r) => setTimeout(r, 0));
    await inner.giveBack(bFirstPlace);
    const c = await admit("req_c");
    const runC = c.run(async () => {
      order.push("c");
    });
    // Let B find its place gone and take a new one behind C.
    await new Promise((r) => setTimeout(r, 120));
    releaseA();
    await Promise.all([runA, runB, runC]);
    expect(order).toEqual(["a", "c", "b"]);
    expect(b.place?.ticket).not.toBe(bFirstPlace.ticket);
  });
});

describe("a running place whose lease is lost", () => {
  it("is told to stop when a renewal reports the place gone", async () => {
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const backend: ConcurrencyLeaseBackend = { ...shaped, renew: async () => false };
      const arbiter = createConcurrencyArbiter({ backend });
      const admission = await arbiter.admit(
        arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
        "req_1"
      );
      let release!: () => void;
      const run = admission.run(() => new Promise<void>((r) => (release = r)));
      expect(admission.lost.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(admission.lost.aborted).toBe(true);
      release();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("is told to stop before its lease can run out when renewals keep failing", async () => {
    // Stopping at half the lease leaves the other half for the run to wind
    // down before another process may take the key: the two never overlap.
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        leaseMs: 10_000,
        renew: async () => {
          throw new Error("lease backend unreachable");
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const admission = await arbiter.admit(
        arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
        "req_1"
      );
      let release!: () => void;
      const run = admission.run(() => new Promise<void>((r) => (release = r)));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(admission.lost.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(admission.lost.aborted).toBe(true);
      release();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not stopped at its turn for renewals that failed while it waited, when the place is still held", async () => {
    // A waiter whose renewals failed for half the lease recorded a loss. The
    // backend may still hold the place (the outage was shorter than the
    // lease): the run starts in its turn, renewed again, rather than being
    // stopped at once for a place it still has.
    vi.useFakeTimers();
    try {
      const { backend: shaped } = fourCallBackend();
      let failFor: string | undefined;
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        leaseMs: 1_000,
        renew: async (place) => {
          if (place.ticket === failFor) throw new Error("lease backend unreachable");
          return shaped.renew(place);
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const admit = async (id: string) =>
        (await arbiter.admit(arbiter.resolve(queueFlow, "respond", envelope(id)), id)) as ConcurrencyAdmission;
      const a = await admit("req_a");
      let releaseA!: () => void;
      const runA = a.run(() => new Promise<void>((r) => (releaseA = r)));
      const b = await admit("req_b");
      failFor = b.place!.ticket;
      let lostAtStart: boolean | undefined;
      const runB = b.run(async () => {
        lostAtStart = b.lost.aborted;
      });
      await vi.advanceTimersByTimeAsync(600);
      failFor = undefined;
      releaseA();
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.all([runA, runB]);
      expect(lostAtStart).toBe(false);
      expect(b.lost.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lines up again at its turn when the place was dropped while its renewals failed", async () => {
    vi.useFakeTimers();
    try {
      const { backend: shaped, inner } = fourCallBackend();
      let failFor: string | undefined;
      const backend: ConcurrencyLeaseBackend = {
        ...shaped,
        leaseMs: 1_000,
        renew: async (place) => {
          if (place.ticket === failFor) throw new Error("lease backend unreachable");
          const kept = await inner.isMyTurn(place);
          return kept === "missing" ? false : undefined;
        }
      };
      const arbiter = createConcurrencyArbiter({ backend });
      const admit = async (id: string) =>
        (await arbiter.admit(arbiter.resolve(queueFlow, "respond", envelope(id)), id)) as ConcurrencyAdmission;
      const a = await admit("req_a");
      let releaseA!: () => void;
      const runA = a.run(() => new Promise<void>((r) => (releaseA = r)));
      const b = await admit("req_b");
      const bFirst = b.place!;
      failFor = bFirst.ticket;
      let lostAtStart: boolean | undefined;
      const runB = b.run(async () => {
        lostAtStart = b.lost.aborted;
      });
      await vi.advanceTimersByTimeAsync(600);
      // The backend dropped it meanwhile, and A gives the key up.
      await inner.giveBack(bFirst);
      failFor = undefined;
      releaseA();
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.all([runA, runB]);
      expect(lostAtStart).toBe(false);
      expect(b.place!.ticket).not.toBe(bFirst.ticket);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is never told to stop over the in-memory default, whose places do not expire", async () => {
    const arbiter = createConcurrencyArbiter();
    const admission = arbiter.admit(
      arbiter.resolve(rejectFlow, "respond", envelope("req_1")),
      "req_1"
    );
    if (isPendingAdmission(admission)) throw new Error("expected a synchronous admission");
    await admission.run(async () => undefined);
    expect(admission.lost.aborted).toBe(false);
  });
});
