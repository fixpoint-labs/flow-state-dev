/**
 * `stores` on `createFlowState` takes three shapes: nothing, one adapter, or
 * the named-profile map. The first two are exactly `{ default: { primary } }`
 * (in memory for the first), so an app's first runtime file names no store
 * until it wants data kept. With no `stores`, startup says the app runs in
 * memory, and in production it warns: a deploy that forgot its store keeps
 * nothing across a restart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { __resetDeprecationWarningsForTests } from "@flow-state-dev/core/helpers";
import { z } from "zod";
import { createFlowState, createInProcessFetch, inMemoryStores, type StoreAdapter } from "../../src";
import { FlowStateConfigError } from "../../src/errors/flow-error";
import type { FlowState } from "../../src/flowstate/types";
import { createInMemoryBus } from "../../src/bus/in-memory-bus";

let flowCounter = 0;

/** A flow whose handler computes its answer from the input. Fresh kind per test: notices are once per process. */
function doublerFlow() {
  flowCounter += 1;
  const kind = `doubler-${flowCounter}`;
  const flow = defineFlow({
    kind,
    authentication: { defaultUserId: "u1", requireUser: false },
    actions: {
      double: {
        inputSchema: z.object({ n: z.number() }),
        block: handler({
          name: "double",
          inputSchema: z.object({ n: z.number() }),
          execute: (input: { n: number }) => ({ doubled: input.n * 2 })
        })
      }
    }
  })();
  return { kind, flows: { [kind]: flow } };
}

/** An in-memory adapter that records what it resolved and whether it was disposed. */
function spyAdapter(capabilities: StoreAdapter["capabilities"] = ["primary"]) {
  const inner = inMemoryStores();
  const resolved: string[][] = [];
  const bus = createInMemoryBus();
  let disposed = 0;
  const adapter: StoreAdapter = {
    capabilities,
    resolve: async (slots) => {
      resolved.push([...slots]);
      return slots.includes("bus") ? { bus } : inner.resolve(["primary"]);
    },
    dispose: () => {
      disposed += 1;
    }
  };
  return { adapter, resolved, bus, disposed: () => disposed };
}

/** Run `double` through the engine's own router and read the stored answer back. */
async function ask(state: FlowState, kind: string, n: number): Promise<unknown> {
  const fetcher = createInProcessFetch(state);
  const sent = await fetcher(`http://x.invalid/api/flows/${kind}/actions/double`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "u1", input: { n } })
  });
  expect(sent.status).toBeLessThan(300);
  const body = (await sent.json()) as { request?: { id: string }; requestId?: string };
  const requestId = (body.request?.id ?? body.requestId)!;
  const { stores } = await state.getRuntime();
  for (let i = 0; i < 100; i += 1) {
    const record = await stores.request.get(requestId);
    if (record?.status === "completed") return (record.result as { output?: unknown } | undefined)?.output;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`request ${requestId} never completed`);
}

function stderrText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.map(String).join(" ")).join("\n");
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const states: FlowState[] = [];

beforeEach(() => {
  __resetDeprecationWarningsForTests();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function make(options: Parameters<typeof createFlowState>[0]): FlowState {
  const state = createFlowState(options);
  states.push(state);
  return state;
}

describe("createFlowState with no stores", () => {
  it("answers an action in memory and says so at startup", async () => {
    const { kind, flows } = doublerFlow();
    const state = make({ flows });

    expect(await ask(state, kind, 21)).toEqual({ doubled: 42 });
    expect(state.activeProfile).toBe("default");
    expect(stderrText(errorSpy)).toMatch(/runs in memory/);
    expect(stderrText(errorSpy)).toContain("stores");
  });

  it("warns once in production, naming `stores` as the fix", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { kind, flows } = doublerFlow();
    const state = make({ flows });
    await ask(state, kind, 1);
    await make({ flows: doublerFlow().flows }).ready();

    const prod = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => /in memory/.test(m));
    expect(prod).toHaveLength(1);
    expect(prod[0]).toContain("`stores`");
  });

  it("does not warn outside production", async () => {
    await make({ flows: doublerFlow().flows }).ready();
    expect(warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => /in memory/.test(m))).toHaveLength(0);
  });
});

describe("createFlowState with one adapter as stores", () => {
  it("runs on that adapter as the default profile's primary, and says nothing about memory", async () => {
    const { kind, flows } = doublerFlow();
    const spy = spyAdapter();
    const state = make({ flows, stores: spy.adapter });

    expect(await ask(state, kind, 4)).toEqual({ doubled: 8 });
    expect(state.activeProfile).toBe("default");
    expect(state.meta.profileKeys).toEqual(["default"]);
    expect(state.meta.declaredSlots).toEqual({ default: ["primary"] });
    expect(spy.resolved).toEqual([["primary"]]);
    expect(stderrText(errorSpy)).not.toMatch(/memory/);

    await state.dispose();
    expect(spy.disposed()).toBe(1);
  });

  it("backs the bus with the adapter when it declares one", async () => {
    const spy = spyAdapter(["primary", "bus"]);
    const state = make({ flows: doublerFlow().flows, stores: spy.adapter });
    await state.ready();
    expect(spy.resolved).toEqual([["primary"], ["bus"]]);
    expect((await state.getRuntime()).stores.bus).toBe(spy.bus);
  });

  it("refuses an FSD_ENV naming another profile, as the one-profile map does", async () => {
    vi.stubEnv("FSD_ENV", "prod");
    const state = make({ flows: doublerFlow().flows, stores: spyAdapter().adapter });
    await expect(state.ready()).rejects.toBeInstanceOf(FlowStateConfigError);
  });
});

describe("createFlowState with named profiles", () => {
  it("reads a map whose profiles are named `resolve` and `capabilities` as profiles, not as an adapter", async () => {
    const state = make({
      flows: doublerFlow().flows,
      stores: { capabilities: { primary: inMemoryStores() }, resolve: { primary: inMemoryStores() } }
    });
    await state.ready();
    expect(state.meta.profileKeys).toEqual(["capabilities", "resolve"]);
    expect(state.activeProfile).toBe("capabilities");
  });

  it("says nothing about memory, even when the profile is in memory", async () => {
    const { kind, flows } = doublerFlow();
    const state = make({ flows, stores: { dev: { primary: inMemoryStores() } } });
    expect(await ask(state, kind, 2)).toEqual({ doubled: 4 });
    expect(state.activeProfile).toBe("dev");
    expect(stderrText(errorSpy)).not.toMatch(/memory/);
  });
});
