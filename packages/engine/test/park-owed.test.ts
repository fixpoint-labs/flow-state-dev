/**
 * A wait killed before it parks (FIX-2269): a wait that starts its own work
 * (a dispatch, a call's send) owes its park through `RequestWaits.owingPark`
 * before it starts it. If the process dies after the work started and before
 * the gate is written, the request is left `interrupted` behind no gate, and
 * the durability sweep continues it: its replay finds the work already
 * started (`runOnce`) and parks on it.
 *
 * Why it matters: without this, the work runs and ends and nobody hears it.
 * The request that asked stays `interrupted` until a person presses Continue,
 * and the answer never reaches the user who was waiting.
 *
 * The process's death is a run frozen at a point (it never returns or writes
 * again) and its record written `interrupted`, as the stale-request sweep
 * writes it.
 */
import { SuspensionError, defineFlow, handler, parkOnWait, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance, WaitOutcome } from "@flow-state-dev/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createWaitResumeOperation } from "../src/context/wait-resume-operation";
import { resumeWaitGate } from "../src/durability/resume-wait-gate";
import { runTick } from "../src/durability/durability-sweeper";
import { PARK_OWED_GIVE_UP_MS, createOwingPark, parkOwedKey } from "../src/durability/park-owed";
import { parkedInterruptedIds } from "../src/durability/stop-suspended";
import { recordRequestStop } from "../src/execution/record-request-stop";
import type { ExecutionResult } from "../src/execution/types";
import type { RuntimeConfig } from "../src/runtime-config";

const GATE_ID = "gate_owed";
const SESSION = "s_waiter";

/** Where the run freezes, as a process that dies there leaves it. */
type Freeze = "after-owe" | "after-work" | "after-wait" | undefined;

type Script = {
  /** Where the next run freezes; cleared once it does. */
  freeze: Freeze;
  /** Whether the wait owes its park (the control drops it). */
  owe: boolean;
  /** How many times the work ran: a replay must not run it again. */
  started: number;
};

function waitingFlow(script: Script) {
  const freezeAt = async (point: Freeze) => {
    if (script.freeze !== point) return;
    script.freeze = undefined;
    await new Promise<never>(() => {});
  };
  const wait = handler({
    name: "start-and-wait",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      const run = async () => {
        await freezeAt("after-owe");
        await ctx.runOnce!("work", async () => {
          script.started += 1;
          return true;
        });
        await freezeAt("after-work");
        const outcome: WaitOutcome = await parkOnWait(ctx, {
          gateId: GATE_ID,
          binding: { requestId: "req_work" },
          deadline: Date.now() + 3_600_000
        });
        return outcome;
      };
      const waits = ctx.requestHost?.waits;
      const outcome = script.owe && waits?.owingPark !== undefined ? await waits.owingPark(run) : await run();
      await freezeAt("after-wait");
      return { outcome };
    }
  });
  return defineFlow({
    kind: "park-owed",
    actions: { run: { block: sequencer({ name: "turn" }).step(wait), inputSchema: z.object({}).passthrough() } }
  })({ id: "park-owed" });
}

function setup(flow: FlowInstance) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const continued: Promise<ExecutionResult>[] = [];
  const runtimeConfig: RuntimeConfig = {};
  const continueHere = async (opts: Parameters<typeof continueRequest>[0]) => {
    const result = await continueRequest({ ...opts, stores, flowRegistry: registry, runtimeConfig });
    continued.push(result.finished);
    return result;
  };
  runtimeConfig.durabilityProvider = provider;
  runtimeConfig.requestHost = {
    waitResume: createWaitResumeOperation({ provider, stores, continueRequest: continueHere as never }),
    wakes: { maxDebtAgeMs: 86_400_000 },
    waits: { provider, deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 } }
  } as never;
  const sweep = () =>
    runTick({
      provider,
      stores,
      holder: "sweeper-test",
      sweepIntervalMs: 600_000,
      checkpointMaxAgeMs: 86_400_000,
      suspensionTerminalMaxAgeMs: 604_800_000,
      orphanCheckpointThresholdMs: 86_400_000,
      batchLimit: 1000,
      continueRequest: continueHere as never
    } as never);
  return { stores, provider, registry, runtimeConfig, continued, sweep };
}

type Harness = ReturnType<typeof setup>;

function start(h: Harness, flow: FlowInstance): Promise<ExecutionResult> {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u_waiter",
    sessionId: SESSION,
    stores: h.stores,
    runtimeConfig: h.runtimeConfig
  } as never);
}

async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out");
}

/** The session's one request, once it exists. */
async function theRequest(h: Harness) {
  let id: string | undefined;
  await until(async () => {
    id = (await h.stores.request.list({ sessionId: SESSION }))[0]?.id;
    return id !== undefined;
  });
  return id!;
}

/** Start a run that freezes at `script.freeze`, and leave it as a dead process does: `interrupted`. */
async function dieWhileRunning(h: Harness, flow: FlowInstance, script: Script): Promise<string> {
  void start(h, flow);
  const id = await theRequest(h);
  await until(async () => script.freeze === undefined);
  await markInterrupted(h, id);
  return id;
}

async function markInterrupted(h: Harness, id: string): Promise<void> {
  const record = (await h.stores.request.get(id))!;
  await h.stores.request.set(id, { ...record, status: "interrupted", interruptedAt: Date.now() }, "any");
}

/** Bring the owed park's wake due now, as the time until the request counts as dead passing would. */
async function owedParkDueNow(h: Harness, id: string): Promise<boolean> {
  const key = parkOwedKey({ id, sessionId: SESSION })!;
  const wake = await h.stores.wakes!.get(key);
  if (wake === null) return false;
  await h.stores.wakes!.move(key, wake.version, Date.now() - 1);
  return true;
}

const status = async (h: Harness, id: string) => (await h.stores.request.get(id))?.status;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a wait killed before it parks", () => {
  it("is continued by the sweep: its replay parks on the work it already started, run once", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    expect(script.started).toBe(1);
    expect(await owedParkDueNow(h, id)).toBe(true);

    await h.sweep();

    expect(h.continued).toHaveLength(1);
    await h.continued[0];
    expect(await status(h, id)).toBe("suspended");
    expect((await h.provider.loadSuspension(id, GATE_ID))?.status).toBe("pending");
    expect(script.started).toBe(1);
    // The park cleared what the wait owed: the gate is the obligation now.
    expect(await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!)).toBeNull();

    // And the answer reaches the request that asked, once.
    const gate = (await h.provider.loadSuspension(id, GATE_ID))!;
    await resumeWaitGate(
      { provider: h.provider, stores: h.stores, continueRequest: (async (opts: never) => {
        const result = await continueRequest({ ...(opts as object), stores: h.stores, flowRegistry: h.registry, runtimeConfig: h.runtimeConfig } as never);
        h.continued.push(result.finished);
        return result;
      }) as never },
      gate,
      { answered: true, answer: "the codename" },
      "test"
    );
    const finished = await h.continued[1]!;
    expect(finished.output).toEqual({ outcome: { answered: true, answer: "the codename" } });
    expect(await status(h, id)).toBe("completed");
    expect(script.started).toBe(1);
  });

  it("keeps owing its park until its gate is logged: a death between the gate and the log is continued and parks", async () => {
    const script: Script = { freeze: undefined, owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    // The process dies as it logs the gate: its suspension record is written, its log never is.
    const flush = h.stores.request.flushItems.bind(h.stores.request);
    const dying = vi.spyOn(h.stores.request, "flushItems").mockImplementation(async (requestId: string) => {
      if ((await h.provider.loadSuspension(requestId, GATE_ID)) !== null) return new Promise<never>(() => {});
      return flush(requestId);
    });
    void start(h, flow);
    const id = await theRequest(h);
    await until(async () => (await h.provider.loadSuspension(id, GATE_ID)) !== null);
    await new Promise((r) => setTimeout(r, 20));
    expect(await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!)).not.toBeNull();

    dying.mockRestore();
    await markInterrupted(h, id);
    expect(await owedParkDueNow(h, id)).toBe(true);
    await h.sweep();
    expect(h.continued).toHaveLength(1);
    await until(async () => (await status(h, id)) === "suspended");
    expect(script.started).toBe(1);
  });

  it("is continued when it died after the owe and before the work started: the replay starts it, once", async () => {
    const script: Script = { freeze: "after-owe", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    expect(script.started).toBe(0);
    expect(await owedParkDueNow(h, id)).toBe(true);

    await h.sweep();
    await h.continued[0];

    expect(await status(h, id)).toBe("suspended");
    expect(script.started).toBe(1);
  });

  it("reads as parked, not dead, while it owes its park: history and retention keep it", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    const record = (await h.stores.request.get(id))!;
    expect((await parkedInterruptedIds(h.provider, [record], h.stores.wakes)).has(id)).toBe(true);
  });

  it("CONTROL: a wait that owes nothing is left interrupted: nothing continues it", async () => {
    const script: Script = { freeze: "after-work", owe: false, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    expect(await owedParkDueNow(h, id)).toBe(false);

    await h.sweep();

    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("interrupted");
    const record = (await h.stores.request.get(id))!;
    expect((await parkedInterruptedIds(h.provider, [record], h.stores.wakes)).has(id)).toBe(false);
  });

  it("CONTROL: a request that parked, was answered and died later owes nothing: the sweep leaves it", async () => {
    const script: Script = { freeze: undefined, owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const parked = await start(h, flow);
    const id = parked.requestId!;
    expect(await status(h, id)).toBe("suspended");
    // The park cleared the owe.
    expect(await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!)).toBeNull();

    // Answered, and the replay dies after the wait returned.
    script.freeze = "after-wait";
    const gate = (await h.provider.loadSuspension(id, GATE_ID))!;
    const continueHere = (async (opts: never) => {
      const result = await continueRequest({ ...(opts as object), stores: h.stores, flowRegistry: h.registry, runtimeConfig: h.runtimeConfig } as never);
      return result;
    }) as never;
    await resumeWaitGate({ provider: h.provider, stores: h.stores, continueRequest: continueHere }, gate, { answered: true, answer: "x" }, "test");
    await until(async () => script.freeze === undefined);
    await markInterrupted(h, id);
    expect(await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!)).toBeNull();

    await h.sweep();

    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("interrupted");
  });

  it("reads as parked when a later wait owes its park after an earlier wait's gate was answered and pruned", async () => {
    const script: Script = { freeze: undefined, owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = (await start(h, flow)).requestId!;
    script.freeze = "after-wait";
    const gate = (await h.provider.loadSuspension(id, GATE_ID))!;
    const continueHere = (async (opts: never) =>
      continueRequest({ ...(opts as object), stores: h.stores, flowRegistry: h.registry, runtimeConfig: h.runtimeConfig } as never)) as never;
    await resumeWaitGate({ provider: h.provider, stores: h.stores, continueRequest: continueHere }, gate, { answered: true, answer: "x" }, "test");
    await until(async () => script.freeze === undefined);
    await markInterrupted(h, id);
    // The answered gate is pruned by age, as retention prunes a terminal one.
    expect(await h.provider.pruneSuspensions(Date.now() + 1, 100)).toBe(1);

    // A second wait in the same request owed its park, then the process died:
    // the log still names the first gate, which is gone.
    const key = parkOwedKey({ id, sessionId: SESSION })!;
    await h.stores.wakes!.owe({ ...key, flowKind: flow.id, userId: "u_waiter", orgId: DEFAULT_ORG_ID, dueAt: Date.now(), landBy: Date.now() });
    const record = (await h.stores.request.get(id))!;
    expect((await parkedInterruptedIds(h.provider, [record], h.stores.wakes)).has(id)).toBe(true);
  });

  it("stays stopped when a person stops it while it owes its park: the stop lets the owe go", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);

    const stop = await recordRequestStop(h.stores.request, (await h.stores.request.get(id))!, {
      provider: h.provider,
      stores: h.stores,
      continueRequest: (async () => {
        throw new Error("a stop of a dead request continues nothing");
      }) as never
    });
    expect(stop).toEqual({ kind: "finished", status: "interrupted" });
    expect(await owedParkDueNow(h, id)).toBe(false);

    await h.sweep();
    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("interrupted");
  });

  it("stays stopped when the stop lands between the sweep's read of the owe and its continuation", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    expect(await owedParkDueNow(h, id)).toBe(true);

    // The sweep has read the owe and moved its wake; a person's stop lands
    // before it takes the lease to continue.
    const stopDeps = { provider: h.provider, stores: h.stores, continueRequest: (async () => undefined) as never };
    const acquire = h.provider.acquireLease.bind(h.provider);
    let stop: unknown;
    vi.spyOn(h.provider, "acquireLease").mockImplementation(async (requestId, options) => {
      if (stop === undefined && options.holder.startsWith("park-owed_")) {
        stop = "stopping";
        stop = await recordRequestStop(h.stores.request, (await h.stores.request.get(id))!, stopDeps);
      }
      return acquire(requestId, options);
    });
    await h.sweep();

    expect(stop).toEqual({ kind: "finished", status: "interrupted" });
    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("interrupted");
  });

  it("is continued when its continuation holds the lease as a stop arrives: the stop says it runs again", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    const lease = (await h.provider.acquireLease(id, { holder: "continuation", durationMs: 60_000 }))!;

    const stop = await recordRequestStop(h.stores.request, (await h.stores.request.get(id))!, {
      provider: h.provider,
      stores: h.stores,
      continueRequest: (async () => undefined) as never
    });
    expect(stop).toEqual({ kind: "already-resolved" });
    // The owe is kept: the stop wrote nothing.
    expect(await owedParkDueNow(h, id)).toBe(true);
    await h.provider.releaseLease(id, lease.leaseId);
  });

  it("is left interrupted, and its owe let go, once it has owed its park past the give-up age", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    const id = await dieWhileRunning(h, flow, script);
    expect(await owedParkDueNow(h, id)).toBe(true);
    const later = Date.now() + PARK_OWED_GIVE_UP_MS + 1_000;
    vi.spyOn(Date, "now").mockReturnValue(later);

    await h.sweep();

    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("interrupted");
    expect(await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!)).toBeNull();
  });

  it("moves its owe on while the request still runs: a slow start is not continued beside itself", async () => {
    const script: Script = { freeze: "after-work", owe: true, started: 0 };
    const flow = waitingFlow(script);
    const h = setup(flow);
    void start(h, flow);
    const id = await theRequest(h);
    await until(async () => script.freeze === undefined);
    expect(await owedParkDueNow(h, id)).toBe(true);

    await h.sweep();

    expect(h.continued).toHaveLength(0);
    expect(await status(h, id)).toBe("in_progress");
    const wake = await h.stores.wakes!.get(parkOwedKey({ id, sessionId: SESSION })!);
    expect(wake!.dueAt).toBeGreaterThan(Date.now());
  });

  describe("when two waits in one request owe the park together", () => {
    const owingPark = () => {
      const wakes = createInMemoryStores().wakes!;
      const owe = createOwingPark({
        store: wakes,
        requestId: "req_both",
        identity: { userId: "u_waiter", tenantId: undefined, orgId: DEFAULT_ORG_ID, sessionId: SESSION },
        flowId: "park-owed",
        fenceMs: 60_000
      });
      const owed = async () => (await wakes.get(parkOwedKey({ id: "req_both", sessionId: SESSION })!)) !== null;
      return { owe, owed };
    };
    const held = () => {
      let release!: (outcome: "return" | "park") => void;
      const gate = new Promise<"return" | "park">((r) => (release = r));
      const work = async () => {
        if ((await gate) === "park") throw new SuspensionError({ reason: "waiting", suspensionId: "s_held" } as never);
        return "done";
      };
      return { work, release };
    };

    it("keeps owing it while the other is still between its work and its gate", async () => {
      const { owe, owed } = owingPark();
      const other = held();
      const pending = owe(other.work);
      await owe(async () => "refused");

      expect(await owed()).toBe(true);
      other.release("return");
      await pending;
      expect(await owed()).toBe(false);
    });

    it("keeps owing it once one has parked, though the other returns after", async () => {
      const { owe, owed } = owingPark();
      const parks = held();
      const parked = owe(parks.work).catch((error: unknown) => error);
      const returns = held();
      const returned = owe(returns.work);
      parks.release("park");
      expect(await parked).toBeInstanceOf(SuspensionError);
      returns.release("return");
      await returned;

      expect(await owed()).toBe(true);
    });
  });
});
