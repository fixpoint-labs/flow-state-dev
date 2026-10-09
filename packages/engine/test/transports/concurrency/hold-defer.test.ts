/**
 * `hold` and `defer` in the arbiter, over the in-memory default and over a
 * shared backend whose places expire.
 *
 * The host-level cases (a notice waits for a reply, a person's reply is never
 * delayed, an aborted or failed reply frees the key) are in
 * `host-concurrency-hold-defer.test.ts`. This file covers what the host can't
 * show in one process: a process that crashes mid-hold, whose place nobody
 * gives back, must not strand a deferred run in another process.
 */
import { describe, expect, it } from "vitest";
import {
  createConcurrencyArbiter,
  type ConcurrencyFlowView
} from "../../../src/transports/concurrency/arbiter";
import {
  createInMemoryLeaseBackend,
  type ConcurrencyLeaseBackend,
  type LeasePlace
} from "../../../src/transports/concurrency/lease-backend";
import {
  ConcurrencyDeferLimitError,
  ConcurrencyLeaseLostError,
  ConcurrencyRejectedError
} from "../../../src/transports/errors";
import type { DispatchEnvelope } from "../../../src/transports/dispatcher";
import { admitAndRun } from "./admit-and-run";

function envelope(requestId: string, actionName: string): DispatchEnvelope {
  return {
    requestId,
    flowKind: "conversation",
    actionName,
    input: {},
    userId: "u_1",
    sessionId: "s_1"
  };
}

const conversation: ConcurrencyFlowView = {
  actions: {
    reply: { concurrency: "hold" },
    notify: { concurrency: "defer" },
    strict: { concurrency: "reject" },
    serial: { concurrency: "queue" }
  }
};

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A shared backend whose places expire `leaseMs` after their last renewal,
 * as a Redis-backed one does. Expired places are swept on every read.
 */
function expiringBackend(leaseMs: number): ConcurrencyLeaseBackend {
  const inner = createInMemoryLeaseBackend();
  const renewedAt = new Map<string, { place: LeasePlace; at: number }>();
  const sweep = async (): Promise<void> => {
    const now = Date.now();
    for (const [ticket, { place, at }] of renewedAt) {
      if (now - at > leaseMs) {
        renewedAt.delete(ticket);
        await inner.giveBack(place);
      }
    }
  };
  return {
    leaseMs,
    async take(input) {
      await sweep();
      const result = await inner.take(input);
      if ("place" in result) renewedAt.set(result.place.ticket, { place: result.place, at: Date.now() });
      return result;
    },
    async isMyTurn(place) {
      await sweep();
      return inner.isMyTurn(place);
    },
    async giveBack(place) {
      renewedAt.delete(place.ticket);
      await inner.giveBack(place);
    },
    async renew(place) {
      const entry = renewedAt.get(place.ticket);
      if (entry === undefined) return false;
      entry.at = Date.now();
    }
  };
}

/** The same backend, seen from a process that has died: it renews nothing. */
function deadProcess(backend: ConcurrencyLeaseBackend): ConcurrencyLeaseBackend {
  return {
    ...backend,
    take: (input) => backend.take(input),
    isMyTurn: (place) => backend.isMyTurn(place),
    giveBack: async () => {},
    renew: () => new Promise<never>(() => {})
  };
}

describe("hold and the other policies on its key", () => {
  it("a hold never waits, even behind another hold", async () => {
    const arbiter = createConcurrencyArbiter();
    const first = deferred();
    const running: string[] = [];
    const r1 = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      async () => {
        running.push("r1");
        await first.promise;
      }
    );
    const r2 = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r2", "reply")), "r2")(
      async () => {
        running.push("r2");
      }
    );
    await r2;
    expect(running).toEqual(["r1", "r2"]);
    first.resolve();
    await r1;
  });

  it("a reject sees a running hold as the key's holder", async () => {
    const arbiter = createConcurrencyArbiter();
    const held = deferred();
    const r1 = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      () => held.promise
    );
    expect(() => arbiter.admit(arbiter.resolve(conversation, "strict", envelope("s1", "strict")), "s1")).toThrow(
      ConcurrencyRejectedError
    );
    held.resolve();
    await r1;
  });

  it("a queue run waits behind a running hold", async () => {
    const arbiter = createConcurrencyArbiter();
    const held = deferred();
    const order: string[] = [];
    const r1 = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      async () => {
        await held.promise;
        order.push("reply ended");
      }
    );
    const q = admitAndRun(arbiter, arbiter.resolve(conversation, "serial", envelope("q1", "serial")), "q1")(
      async () => {
        order.push("queued ran");
      }
    );
    await tick();
    expect(order).toEqual([]);
    held.resolve();
    await Promise.all([r1, q]);
    expect(order).toEqual(["reply ended", "queued ran"]);
  });
});

describe("a deferred run when the process holding the key crashes", () => {
  it("runs once the crashed process's place expires, and not before", async () => {
    const leaseMs = 300;
    const shared = expiringBackend(leaseMs);
    // Two processes of one deployment: the one replying dies mid-reply.
    const crashed = createConcurrencyArbiter({ backend: deadProcess(shared) });
    const survivor = createConcurrencyArbiter({ backend: shared });

    const replyAdmission = await crashed.admit(
      crashed.resolve(conversation, "reply", envelope("r1", "reply")),
      "r1"
    );
    // The reply never settles: its process is gone, so nothing gives its
    // place back and nothing renews it.
    void replyAdmission.run(() => new Promise<never>(() => {}));

    const crashedAt = Date.now();
    let ranAt: number | undefined;
    const notice = admitAndRun(
      survivor,
      survivor.resolve(conversation, "notify", envelope("n1", "notify")),
      "n1"
    )(async () => {
      ranAt = Date.now();
    });

    await tick(leaseMs / 2);
    expect(ranAt).toBeUndefined();

    await notice;
    expect(ranAt! - crashedAt).toBeGreaterThanOrEqual(leaseMs);
  });

  it("keeps the key held while a live process renews its hold past the lease", async () => {
    // The control for the case above: expiry frees a dead holder's place, not
    // a live one's. A reply longer than the lease still holds the notice off.
    const leaseMs = 300;
    const shared = expiringBackend(leaseMs);
    const replying = createConcurrencyArbiter({ backend: shared });
    const other = createConcurrencyArbiter({ backend: shared });

    const held = deferred();
    const reply = admitAndRun(replying, replying.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      () => held.promise
    );
    let ran = false;
    const notice = admitAndRun(other, other.resolve(conversation, "notify", envelope("n1", "notify")), "n1")(
      async () => {
        ran = true;
      }
    );

    await tick(leaseMs * 3);
    expect(ran).toBe(false);
    held.resolve();
    await Promise.all([reply, notice]);
    expect(ran).toBe(true);
  });
});

describe("the bound on waiting defer requests", () => {
  it("refuses a defer past the per-key cap while the key is held, and admits again once the line drains", async () => {
    const arbiter = createConcurrencyArbiter({ maxDeferredPerKey: 2 });
    const held = deferred();
    const reply = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      () => held.promise
    );
    const notify = (id: string) =>
      admitAndRun(arbiter, arbiter.resolve(conversation, "notify", envelope(id, "notify")), id)(
        async () => undefined
      );
    const waiting = [notify("n1"), notify("n2")];

    let refusal: unknown;
    try {
      notify("n3");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ConcurrencyDeferLimitError);
    // Every adapter already maps a concurrency refusal: 409, skipped, busy.
    expect(refusal).toBeInstanceOf(ConcurrencyRejectedError);
    expect((refusal as ConcurrencyDeferLimitError).status).toBe(409);
    expect((refusal as ConcurrencyDeferLimitError).limit).toBe(2);

    held.resolve();
    await Promise.all([reply, ...waiting]);
    await notify("n4");
  });

  it("counts a defer that left the line by withdrawal, so cancelled waits never use up the cap", async () => {
    const arbiter = createConcurrencyArbiter({ maxDeferredPerKey: 1 });
    const held = deferred();
    const reply = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      () => held.promise
    );
    const withdraw = new AbortController();
    const first = arbiter.admit(arbiter.resolve(conversation, "notify", envelope("n1", "notify")), "n1");
    const firstRun = (first as Awaited<typeof first>).run(async () => undefined, withdraw.signal);
    withdraw.abort();
    await expect(firstRun).rejects.toThrow(/withdrawn/);

    const second = admitAndRun(arbiter, arbiter.resolve(conversation, "notify", envelope("n2", "notify")), "n2")(
      async () => undefined
    );
    held.resolve();
    await Promise.all([reply, second]);
  });
});

describe("a defer request a caller keeps holding off", () => {
  it("stops yielding to newer holds after its patience, and runs once the holds it found have ended", async () => {
    const arbiter = createConcurrencyArbiter({ deferPatienceMs: 100 });
    const hold = (id: string, ms: number) =>
      admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope(id, "reply")), id)(() => tick(ms));

    // A chain of overlapping replies, so the key is never free for 1.2 seconds.
    const chain: Promise<void>[] = [hold("r0", 150)];
    let ranAt: number | undefined;
    const startedAt = Date.now();
    const notice = admitAndRun(arbiter, arbiter.resolve(conversation, "notify", envelope("n1", "notify")), "n1")(
      async () => {
        ranAt = Date.now() - startedAt;
      }
    );
    for (let i = 1; i <= 10; i += 1) {
      await tick(100);
      chain.push(hold(`r${i}`, 150));
    }
    await Promise.all([...chain, notice]);

    // Without the patience bound it runs only after the whole chain (~1.15s).
    expect(ranAt).toBeDefined();
    expect(ranAt!).toBeLessThan(600);
  });
});

describe("a claimed defer's release and lost signal", () => {
  it("frees its cap slot when released without running", async () => {
    const arbiter = createConcurrencyArbiter({ maxDeferredPerKey: 1 });
    const held = deferred();
    const reply = admitAndRun(arbiter, arbiter.resolve(conversation, "reply", envelope("r1", "reply")), "r1")(
      () => held.promise
    );
    const decision = arbiter.resolve(conversation, "notify", envelope("n1", "notify"));
    const first = arbiter.admit(decision, "n1") as Awaited<ReturnType<typeof arbiter.admit>>;
    await first.release();
    // The slot is free again, and the released defer took no place.
    const second = admitAndRun(arbiter, arbiter.resolve(conversation, "notify", envelope("n2", "notify")), "n2")(
      async () => undefined
    );
    held.resolve();
    await Promise.all([reply, second]);
  });

  it("gives the key back when its run settles, so the next defer runs", async () => {
    const arbiter = createConcurrencyArbiter();
    const order: string[] = [];
    const notify = (id: string) =>
      admitAndRun(arbiter, arbiter.resolve(conversation, "notify", envelope(id, "notify")), id)(async () => {
        order.push(id);
        await tick();
      });
    await Promise.all([notify("n1"), notify("n2")]);
    expect(order).toEqual(["n1", "n2"]);
    // Nothing is left on the key: a reject claims it.
    await admitAndRun(arbiter, arbiter.resolve(conversation, "strict", envelope("s1", "strict")), "s1")(
      async () => undefined
    );
  });

  it("fires lost while it runs when its claimed place can no longer be kept, and never before the claim", async () => {
    const inner = createInMemoryLeaseBackend();
    let keep = true;
    const backend: ConcurrencyLeaseBackend = {
      leaseMs: 200,
      take: (input) => inner.take(input),
      isMyTurn: (place) => inner.isMyTurn(place),
      giveBack: (place) => inner.giveBack(place),
      renew: async () => keep
    };
    const arbiter = createConcurrencyArbiter({ backend });
    const admission = await arbiter.admit(
      arbiter.resolve(conversation, "notify", envelope("n1", "notify")),
      "n1"
    );
    expect(admission.lost.aborted).toBe(false);
    let reason: unknown;
    await admission.run(async () => {
      // The host reads `lost` here, when the run starts.
      const lost = admission.lost;
      keep = false;
      await new Promise<void>((resolve) => lost.addEventListener("abort", () => resolve(), { once: true }));
      reason = lost.reason;
    });
    expect(reason).toBeInstanceOf(ConcurrencyLeaseLostError);
  });
});
