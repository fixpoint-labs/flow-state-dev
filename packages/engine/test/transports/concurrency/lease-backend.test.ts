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
  type ConcurrencyFlowView
} from "../../../src/transports/concurrency/arbiter";
import { admitAndRun } from "./admit-and-run";
import {
  createInMemoryLeaseBackend,
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

      admission.handOff();
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
