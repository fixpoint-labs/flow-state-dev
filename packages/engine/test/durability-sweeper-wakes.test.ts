/**
 * The durability sweeper's wake step (FIX-2078 D1): a debt's due time is a wake
 * the engine keeps, fired as its owner until a pass in its session clears it.
 *
 * Real in-memory stores and the real checkpoint provider; the one stand-in is
 * the host's dispatch (`fireWake`), whose calls are what the step produces.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { StoreRegistry, WakeInput, WakeRecord } from "../src/stores/types";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createDurabilitySweeper, runTick, WAKE_RETRY_MS } from "../src/durability/durability-sweeper";
import { createRequestWakes } from "../src/durability/request-wakes";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function wake(overrides: Partial<WakeInput> = {}): WakeInput {
  return {
    sessionId: "s1",
    entry: "runTaskBoard",
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
    expect(fired[0]!.wake).toMatchObject({ entry: "runTaskBoard", flowKind: "desk", userId: "u1", orgId: "o1" });
    expect(fired[0]!.storedDueAt).toBeGreaterThanOrEqual(before + WAKE_RETRY_MS);
  });

  it("a wake whose fire throws stays kept, and fires again once due", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    await runTick(tickArgs(stores, async () => {
      throw new Error("the host refused");
    }));
    const kept = await stores.wakes!.get({ sessionId: "s1", entry: "runTaskBoard" });
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
    await verb.owe({ entry: "runTaskBoard", dueAt: owedAt + 100 });
    await sleep(1_600);
    expect(fired).toHaveLength(1);
    expect(fired[0]! - owedAt).toBeLessThan(1_500);
  });

  it("without a way to fire, or a store that keeps wakes, the step does nothing", async () => {
    const stores = createInMemoryStores();
    await stores.wakes!.owe(wake());
    const { fireWake: _none, ...args } = tickArgs(stores, async () => {});
    await runTick(args);
    expect((await stores.wakes!.get({ sessionId: "s1", entry: "runTaskBoard" }))?.dueAt).toBeLessThan(Date.now());
    const { wakes: _gone, ...bare } = createInMemoryStores();
    await runTick(tickArgs(bare as StoreRegistry, async () => {
      throw new Error("never fired");
    }));
  });
});
