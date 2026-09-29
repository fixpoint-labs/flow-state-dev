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
import { describe, expect, it } from "vitest";
import {
  createConcurrencyArbiter,
  type ConcurrencyFlowView
} from "../../../src/transports/concurrency/arbiter";
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
    return arbiter.gate(d, `req_${i}`)(async () => {
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
    const first = a.gate(a.resolve(rejectFlow, "respond", envelope("req_a")), "req_a")(() => held);

    const d = b.resolve(rejectFlow, "respond", envelope("req_b"));
    let refused: unknown;
    try {
      b.gate(d, "req_b");
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(ConcurrencyRejectedError);
    expect((refused as ConcurrencyRejectedError).inFlightRequestId).toBe("req_a");

    release();
    await first;
    expect(() => b.gate(b.resolve(rejectFlow, "respond", envelope("req_c")), "req_c")).not.toThrow();
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
    const first = a.gate(a.resolve(rejectFlow, "respond", envelope("req_a")), "req_a")(() => held);
    await new Promise((r) => setTimeout(r, 1));

    let loserRan = false;
    const second = b.gate(b.resolve(rejectFlow, "respond", envelope("req_b")), "req_b")(async () => {
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
    const run = arbiter.gate(arbiter.resolve(queueFlow, "respond", envelope("req_1")), "req_1")(
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
    await arbiter.gate(d, "req_1")(async () => undefined);
    expect(calls).toEqual([]);
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
