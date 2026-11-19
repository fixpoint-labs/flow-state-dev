/**
 * The durability sweeper's wake step (FIX-2078 D1): a debt's due time is a wake
 * the engine keeps, fired as its owner until a pass in its session clears it.
 *
 * Real in-memory stores and the real checkpoint provider; the one stand-in is
 * the host's dispatch (`fireWake`), whose calls are what the step produces.
 */
import { FlowError } from "@flow-state-dev/core";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { StoreRegistry, WakeInput, WakeRecord } from "../src/stores/types";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createDurabilitySweeper, runTick, WAKE_RETRY_MS } from "../src/durability/durability-sweeper";
import { createRequestWakes, fireWakeThrough } from "../src/durability/request-wakes";
import type { InboundDispatchHandle, InboundTransportHost } from "../src/transports/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function wake(overrides: Partial<WakeInput> = {}): WakeInput {
  return {
    sessionId: "s1",
    entry: "dispatch",
    flowKind: "desk",
    userId: "u1",
    orgId: "o1",
    dueAt: Date.now() - 1,
    landBy: Date.now() + 30_000,
    ...overrides
  };
}

function tickArgs(stores: StoreRegistry, fireWake: (w: WakeRecord) => Promise<void>) {
  return {
    provider: createCheckpointDurabilityProvider(stores),
    stores,
    holder: "test-holder",
    sweepIntervalMs: 600_000,
    checkpointMaxAgeMs: 86_400_000,
    suspensionTerminalMaxAgeMs: 604_800_000,
    orphanCheckpointThresholdMs: 86_400_000,
    batchLimit: 1000,
    fireWake
  };
}

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("durability sweeper: wakes", () => {
  it("fires each due wake as the owner it names, after moving it one retry out; a wake not due is left", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake({ sessionId: "due" }));
    await stores.wakes!.owe(wake({ sessionId: "later", dueAt: Date.now() + 60_000 }));
    const fired: Array<{ wake: WakeRecord; storedDueAt: number | undefined }> = [];
    const before = Date.now();
    await runTick(
      tickArgs(stores, async (w) => {
        // What the store holds as the fire happens: already moved, so a fire
        // that dies leaves the wake to fire again.
        fired.push({ wake: w, storedDueAt: (await stores.wakes!.get(w))?.dueAt });
      })
    );
    expect(fired.map((f) => f.wake.sessionId)).toEqual(["due"]);
    expect(fired[0]!.wake).toMatchObject({ entry: "dispatch", flowKind: "desk", userId: "u1", orgId: "o1" });
    expect(fired[0]!.storedDueAt).toBeGreaterThanOrEqual(before + WAKE_RETRY_MS);
  });

  it("a wake whose fire throws stays kept, and fires again once due", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    await runTick(tickArgs(stores, async () => {
      throw new Error("the host refused");
    }));
    const kept = await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" });
    expect(kept).not.toBeNull();
    // Due again: the next tick fires it.
    await stores.wakes!.move(kept!, kept!.version, Date.now() - 1);
    const fired: string[] = [];
    await runTick(tickArgs(stores, async (w) => {
      fired.push(w.sessionId);
    }));
    expect(fired).toEqual(["s1"]);
  });

  it("a host that started with a wake already due fires it at once, not at its interval", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    const fired: string[] = [];
    const sweeper = createDurabilitySweeper({
      provider: createCheckpointDurabilityProvider(stores),
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      fireWake: async (w) => {
        fired.push(w.sessionId);
      }
    });
    disposers.push(() => sweeper.dispose());
    await sleep(1_500);
    expect(fired).toEqual(["s1"]);
  });

  it("a wake owed in this process brings the armed tick forward to its due time", async () => {
    const stores = createInMemoryStores();
    const fired: number[] = [];
    const sweeper = createDurabilitySweeper({
      provider: createCheckpointDurabilityProvider(stores),
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      fireWake: async () => {
        fired.push(Date.now());
      }
    });
    disposers.push(() => sweeper.dispose());
    await sleep(200);
    expect(fired).toEqual([]);
    const verb = createRequestWakes({
      store: stores.wakes!,
      sessions: stores.session,
      identity: { userId: "u1", tenantId: undefined, orgId: "o1", sessionId: "s1" },
      flowId: "desk",
      fenceMs: 30_000,
      maxDebtAgeMs: 86_400_000
    });
    const owedAt = Date.now();
    await verb.owe({ entry: "dispatch", dueAt: owedAt + 100 });
    await sleep(1_600);
    expect(fired).toHaveLength(1);
    expect(fired[0]! - owedAt).toBeLessThan(1_500);
  });

  it("without a way to fire, or a store that keeps wakes, the step does nothing", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    const { fireWake: _none, ...args } = tickArgs(stores, async () => {});
    await runTick(args);
    expect((await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" }))?.dueAt).toBeLessThan(Date.now());
    const { wakes: _gone, ...bare } = createInMemoryStores();
    await runTick(tickArgs(bare as StoreRegistry, async () => {
      throw new Error("never fired");
    }));
  });
});

// FIX-2849.
describe("a fired wake whose run is refused at its start", () => {
  /** A host whose dispatch is accepted and whose run then ends with `error`. */
  function hostEndingWith(stores: StoreRegistry, error: unknown): Pick<InboundTransportHost, "dispatch" | "stores"> {
    return {
      stores,
      dispatch: () => {
        const finished = Promise.reject(error);
        void finished.catch(() => {});
        return { requestId: "r1", accepted: Promise.resolve(), finished } as unknown as InboundDispatchHandle;
      }
    };
  }

  // As a run's caller receives it: the block's throw, wrapped in a FlowError.
  const refusal = new FlowError('Worker "my.desk" was fired.', {
    code: "execution_error",
    cause: Object.assign(new Error('Worker "my.desk" was fired.'), { code: "worker-turn-refused" })
  });

  it("is cleared, not fired again: a session that refuses every turn is never retried", async () => {
    // Why: the sweep moves a wake one retry out before it fires, and only a
    // pass in the session clears it. A session whose every start is refused
    // never runs that pass, so without this the wake fires every 30 s forever.
    const stores = createInMemoryStores();
    // Past its fence: no writer that owed it can still be landing.
    await stores.wakes!.owe(wake({ landBy: Date.now() - 1 }));
    const host = hostEndingWith(stores, refusal);
    let fires = 0;
    await runTick(tickArgs(stores, async (w) => {
      fires += 1;
      await fireWakeThrough(host, w);
    }));
    await sleep(10);
    expect(fires).toBe(1);
    expect(await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" })).toBeNull();
  });

  it("is kept until its fence when refused inside it, then cleared by the fire past it", async () => {
    // Why: a writer owes the wake before it writes its debt, and the fence is
    // how long that write may take. Cleared at once, a debt written after the
    // refused fire would be left with no wake, never paid.
    const stores = createInMemoryStores();
    // A fence past the sweep's own retry, so the refusal has to keep the wake to it.
    const landBy = Date.now() + 200;
    await stores.wakes!.owe(wake({ landBy }));
    const host = hostEndingWith(stores, refusal);
    await runTick({ ...tickArgs(stores, (w) => fireWakeThrough(host, w)) });
    await sleep(10);
    const kept = await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" });
    expect(kept).not.toBeNull();
    expect(kept!.dueAt).toBeGreaterThanOrEqual(landBy);
    // Past the fence, the fire is refused again, and the wake is cleared.
    await sleep(250);
    await stores.wakes!.move(kept!, kept!.version, Date.now() - 1);
    await runTick(tickArgs(stores, (w) => fireWakeThrough(host, w)));
    await sleep(10);
    expect(await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" })).toBeNull();
  });

  it("is kept when the fire began inside its fence, however late the refused run ends", async () => {
    // Why: the refused run reads its board as it starts. Begun inside the
    // fence, it may have missed a debt a writer was still landing, so the
    // wake must outlive it even when the refusal comes after the fence.
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake({ landBy: Date.now() + 100 }));
    const host: Pick<InboundTransportHost, "dispatch" | "stores"> = {
      stores,
      dispatch: () => {
        const finished = new Promise((_resolve, reject) => setTimeout(() => reject(refusal), 200));
        void finished.catch(() => {});
        return { requestId: "r1", accepted: Promise.resolve(), finished } as unknown as InboundDispatchHandle;
      }
    };
    let finished: Promise<unknown> | undefined;
    await runTick(tickArgs(stores, (w) => fireWakeThrough(host, w, (run) => (finished = run.finished))));
    await finished!.catch(() => undefined);
    expect(await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" })).not.toBeNull();
  });

  it("is cleared before the run a host waits on at shutdown counts as finished", async () => {
    // Why: a host drains the runs its fired wakes started before it closes its
    // stores. A clear still in flight then would be cut off, and the refused
    // wake would fire again on the next host.
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake({ landBy: Date.now() - 1 }));
    const realClear = stores.wakes!.clear.bind(stores.wakes!);
    stores.wakes!.clear = async (key, version) => {
      await sleep(50);
      return realClear(key, version);
    };
    const host = hostEndingWith(stores, refusal);
    let finished: Promise<unknown> | undefined;
    await runTick(tickArgs(stores, (w) => fireWakeThrough(host, w, (run) => (finished = run.finished))));
    await finished!.catch(() => undefined);
    expect(await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" })).toBeNull();
  });

  it("keeps a debt owed since the fire: only the wake the fire read is cleared", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    let finish!: (error: unknown) => void;
    const host: Pick<InboundTransportHost, "dispatch" | "stores"> = {
      stores,
      dispatch: () => {
        const finished = new Promise((_resolve, reject) => (finish = reject));
        void finished.catch(() => {});
        return { requestId: "r1", accepted: Promise.resolve(), finished } as unknown as InboundDispatchHandle;
      }
    };
    await runTick(tickArgs(stores, (w) => fireWakeThrough(host, w)));
    // A new debt lands while the refused run is still starting.
    await stores.wakes!.owe(wake({ dueAt: Date.now() + 5_000 }));
    finish(refusal);
    await sleep(10);
    expect(await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" })).not.toBeNull();
  });

  it("stays kept when the run fails any other way: a failure that may pass is retried", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    await runTick(tickArgs(stores, (w) => fireWakeThrough(hostEndingWith(stores, new Error("store unavailable")), w)));
    await sleep(10);
    const kept = await stores.wakes!.get({ sessionId: "s1", entry: "dispatch" });
    expect(kept?.dueAt).toBeGreaterThan(Date.now());
  });
});
