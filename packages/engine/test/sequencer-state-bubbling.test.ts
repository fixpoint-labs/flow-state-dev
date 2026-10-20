/**
 * `sequencerStateSchema` joins the sequencer `ctx.sequencer` resolves to.
 * Provider-free: every block is a handler.
 */
import {
  defineCapability,
  defineFlow,
  handler,
  router,
  sequencer,
  SequencerSchemaMismatchError,
  transientSlot,
  DEFAULT_ORG_ID
} from "@flow-state-dev/core";
import type { FlowInstance, ResumeAction, SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

function run(flow: FlowInstance, input: unknown = {}) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    userId: "user",
    sessionId: "sess",
    stores: createInMemoryStores(),
    runtimeConfig: {}
  });
}

function flowOf(
  kind: string,
  block: Parameters<typeof defineFlow>[0]["actions"][string]["block"],
  id?: string
) {
  return defineFlow({ kind, actions: { run: { inputSchema: z.any(), block } } })(
    id === undefined ? undefined : { id }
  );
}

/** A block that reports the enclosing sequencer's whole state. */
const reportState = handler({
  name: "report-state",
  inputSchema: z.any(),
  outputSchema: z.unknown(),
  execute: (_input, ctx) => ctx.sequencer?.state ?? null
});

describe("a child's sequencerStateSchema bubbles to the enclosing sequencer", () => {
  it("installs the child's field, with its default, on the sequencer's state", async () => {
    const readProgress = handler({
      name: "read-progress",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      sequencerStateSchema: z.object({ progress: z.number().default(0) }),
      execute: (_input, ctx) => ctx.sequencer?.state.progress
    });
    const seq = sequencer({
      name: "owner",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string().default("x") })
    })
      .step(readProgress)
      .step(reportState);

    const result = await run(flowOf("bubble-default", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ label: "x", progress: 0 });
  });

  it("passes through a sequencer that declares no state, to the one that does", async () => {
    // A stateless sequencer stays transparent, so the write lands on the owner
    // (debate's per-speaker sub-sequencer and plan-and-execute's seed rely on it).
    const bump = handler({
      name: "bump",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ hits: z.number().default(10) }),
      execute: async (input, ctx) => {
        await ctx.sequencer!.incState({ hits: 1 });
        return input;
      }
    });
    const inner = sequencer({ name: "inner", inputSchema: z.any() }).tap(bump);
    const outer = sequencer({
      name: "outer",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string().default("x") })
    })
      .step(inner)
      .step(reportState);

    const result = await run(flowOf("bubble-transparent", outer));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ label: "x", hits: 11 });
  });

  it("reaches the sequencer through a router's routes", async () => {
    const routed = handler({
      name: "routed",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      sequencerStateSchema: z.object({ visits: z.number().default(3) }),
      execute: (_input, ctx) => ctx.sequencer?.state.visits
    });
    const pick = router({
      name: "pick",
      inputSchema: z.any(),
      routes: [routed],
      execute: () => routed
    });
    const seq = sequencer({
      name: "router-owner",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string().default("x") })
    }).step(pick);

    const result = await run(flowOf("bubble-router", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(3);
  });

  it("reaches the sequencer from a block-level rescue handler", async () => {
    // The recovery block runs in the failing block's place, under the same `ctx.sequencer`.
    const recovery = handler({
      name: "recovery",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      sequencerStateSchema: z.object({ recovered: z.number().default(4) }),
      execute: (_input, ctx) => ctx.sequencer?.state ?? null
    });
    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("worker failed");
      }
    });
    const seq = sequencer({
      name: "rescue-owner",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string().default("x") })
    }).step(worker.rescue([{ block: recovery }]));

    const result = await run(flowOf("bubble-block-rescue", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ label: "x", recovered: 4 });
  });

  it("refuses a block-level rescue handler that conflicts with the sequencer", () => {
    const recovery = handler({
      name: "recovery-number",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ label: z.number() }),
      execute: (input) => input
    });
    const worker = handler({ name: "worker-plain", inputSchema: z.any(), outputSchema: z.any(), execute: (i) => i });
    const parent = sequencer({
      name: "rescue-conflict",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string() })
    });

    expect(() => parent.step(worker.rescue([{ block: recovery }]))).toThrow(SequencerSchemaMismatchError);
  });

  it("lands inside a wrapped object stateSchema and keeps the wrapper", async () => {
    // `z.object(...).default({})` built before bubbling existed; it must still
    // compose, and the `.default({})` must survive the added field.
    const needsProgress = handler({
      name: "needs-progress",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ progress: z.number(), extra: z.string().default("e") }),
      execute: (input) => input
    });
    const seq = sequencer({
      name: "wrapped-owner",
      inputSchema: z.any(),
      stateSchema: z.object({ progress: z.number().default(0) }).default({})
    })
      .tap(needsProgress)
      .step(reportState);

    expect(seq.config.stateSchema!.parse(undefined)).toEqual({ progress: 0, extra: "e" });
    const result = await run(flowOf("bubble-wrapped", seq));
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ progress: 0, extra: "e" });
  });

  it("keeps a child's transient field off the stream under a wrapped stateSchema", async () => {
    // The wrapper stays at the root of the joined schema; the transient mark
    // must still be found through it, or the value reaches SSE and checkpoints.
    const writeScratch = handler({
      name: "write-scratch",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ scratch: transientSlot(z.string().optional()) }),
      execute: async (input, ctx) => {
        await ctx.sequencer!.patchState({ scratch: "secret" });
        return input;
      }
    });
    const seq = sequencer({
      name: "wrapped-transient-owner",
      inputSchema: z.any(),
      stateSchema: z.object({ visible: z.number().default(0) }).default({})
    })
      .step(writeScratch)
      .step(reportState);

    const result = await run(flowOf("bubble-wrapped-transient", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ visible: 0, scratch: "secret" });
    const leaked = (result.items as Array<{ type: string }>).filter(
      (item) =>
        (item.type === "state_change" || item.type === "state_snapshot") &&
        JSON.stringify(item).includes("secret")
    );
    expect(leaked).toEqual([]);
  });

  it("reads the fields of a wrapped object requirement", async () => {
    const wrappedRequirement = handler({
      name: "wrapped-requirement",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ visits: z.number().default(2) }).default({}),
      execute: (input) => input
    });
    const seq = sequencer({
      name: "wrapped-requirement-owner",
      inputSchema: z.any(),
      stateSchema: z.object({ label: z.string().default("x") })
    })
      .tap(wrappedRequirement)
      .step(reportState);

    const result = await run(flowOf("bubble-wrapped-requirement", seq));
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ label: "x", visits: 2 });
  });
});

describe("an incompatible sequencer stateSchema is refused at build time", () => {
  const needsNumber = handler({
    name: "needs-number",
    inputSchema: z.any(),
    outputSchema: z.any(),
    sequencerStateSchema: z.object({ progress: z.number() }),
    execute: (input) => input
  });

  it("refuses a string field composed with a child that requires a number", () => {
    const parent = sequencer({
      name: "string-parent",
      inputSchema: z.any(),
      stateSchema: z.object({ progress: z.string() })
    });

    expect(() => parent.tap(needsNumber)).toThrow(SequencerSchemaMismatchError);
    expect(() => parent.tap(needsNumber)).toThrow(/"progress"/);
  });

  it("refuses the same conflict through a stateless intermediate sequencer", () => {
    const inner = sequencer({ name: "inner-relay", inputSchema: z.any() }).tap(needsNumber);
    const parent = sequencer({
      name: "string-parent-outer",
      inputSchema: z.any(),
      stateSchema: z.object({ progress: z.string() })
    });

    expect(() => parent.step(inner)).toThrow(SequencerSchemaMismatchError);
  });

  const needsString = handler({
    name: "needs-string",
    inputSchema: z.any(),
    outputSchema: z.any(),
    sequencerStateSchema: z.object({ progress: z.string() }),
    execute: (input) => input
  });

  it("refuses two routes that require different kinds of the same field, when the router is built", () => {
    expect(() =>
      router({
        name: "conflicting-routes",
        inputSchema: z.any(),
        routes: [needsNumber, needsString],
        execute: () => needsNumber
      })
    ).toThrow(SequencerSchemaMismatchError);
  });

  it("refuses two siblings that disagree on a field inside a stateless sequencer", () => {
    const relay = sequencer({ name: "sibling-relay", inputSchema: z.any() }).tap(needsNumber);

    expect(() => relay.tap(needsString)).toThrow(SequencerSchemaMismatchError);
  });

  it("accepts a compatible field whose parent side carries the default", async () => {
    // The docs' own example: the parent adds `.default(0)`, the child does not.
    const parent = sequencer({
      name: "number-parent",
      inputSchema: z.any(),
      stateSchema: z.object({ progress: z.number().default(0) })
    })
      .tap(needsNumber)
      .step(reportState);

    const result = await run(flowOf("bubble-compatible", parent));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ progress: 0 });
  });
});

describe("a capability's sequencerStateSchema is installed on the sequencer that uses it", () => {
  it("makes the capability's field, with its default, part of the sequencer's state", async () => {
    const progressCap = defineCapability({
      name: "progress-cap",
      sequencerStateSchema: z.object({ progress: z.number().default(7) })
    });
    const seq = sequencer({ name: "cap-owner", inputSchema: z.any(), uses: [progressCap] }).step(reportState);

    const result = await run(flowOf("bubble-capability", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ progress: 7 });
  });

  it("keeps the capability's defaults when it also requires a field with no default", async () => {
    // `current` starts absent until a block writes it; it must not cost `progress` its default.
    const progressCap = defineCapability({
      name: "progress-cap-required",
      sequencerStateSchema: z.object({ current: z.string(), progress: z.number().default(7) })
    });
    const seq = sequencer({ name: "cap-required-owner", inputSchema: z.any(), uses: [progressCap] }).step(
      reportState
    );

    const result = await run(flowOf("bubble-capability-required", seq));

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ progress: 7 });
  });

  it("refuses a capability field that conflicts with the sequencer's own stateSchema", () => {
    const progressCap = defineCapability({
      name: "progress-cap-number",
      sequencerStateSchema: z.object({ progress: z.number().default(7) })
    });

    expect(() =>
      sequencer({
        name: "cap-conflict",
        inputSchema: z.any(),
        stateSchema: z.object({ progress: z.string() }),
        uses: [progressCap]
      })
    ).toThrow(SequencerSchemaMismatchError);
  });

  it("refuses two capabilities that require different kinds of the same field", () => {
    // Merging the two before the check would keep only the later one, and
    // hand the earlier capability a field of the wrong kind.
    const numberCap = defineCapability({
      name: "progress-number",
      sequencerStateSchema: z.object({ progress: z.number().default(7) })
    });
    const stringCap = defineCapability({
      name: "progress-string",
      sequencerStateSchema: z.object({ progress: z.string().default("seven") })
    });

    expect(() =>
      sequencer({ name: "two-cap-conflict", inputSchema: z.any(), uses: [numberCap, stringCap] })
    ).toThrow(SequencerSchemaMismatchError);
    expect(() =>
      sequencer({ name: "two-cap-conflict", inputSchema: z.any(), uses: [numberCap, stringCap] })
    ).toThrow(/capability "progress-string"/);
  });
});

describe("a checkpoint written before a field bubbled in still restores", () => {
  it("restores the saved fields and fills the new field from its default", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider(stores);
    const stateSchema = z.object({ label: z.string().default("fresh") });
    const readProgress = handler({
      name: "read-progress",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ progress: z.number().default(5) }),
      execute: (input) => input
    });
    const owner = sequencer({ name: "durable-owner", inputSchema: z.any(), stateSchema, durable: true });

    const write = handler({
      name: "write",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        await ctx.sequencer!.patchState({ label: "saved" });
        return input;
      }
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "continue?" });
        return input;
      }
    });
    // v1 wrote the checkpoint before any block required `progress`.
    const v1 = flowOf(
      "bubble-resume",
      owner.step(write).step(gate).step(reportState),
      "bubble-resume"
    );

    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: v1,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });
    expect(suspension).toBeDefined();

    const v2 = flowOf(
      "bubble-resume",
      owner.step(write).step(gate).tap(readProgress).step(reportState),
      "bubble-resume"
    );

    const resumed = await resolve(v2, stores, provider, requestId, suspension!, "approve");

    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toEqual({ label: "saved", progress: 5 });
  });
});

async function resolve(
  flow: FlowInstance,
  stores: ReturnType<typeof createInMemoryStores>,
  provider: ReturnType<typeof createCheckpointDurabilityProvider>,
  requestId: string,
  suspension: SuspensionRecord,
  action: ResumeAction
) {
  await provider.suspend({ ...suspension, status: "approved", resolvedAt: Date.now() });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: { suspensionId: suspension.suspensionId, action, resumedBy: "reviewer" },
    runtimeConfig: { durabilityProvider: provider }
  });
  return finished;
}
