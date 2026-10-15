/**
 * Sequencer state schema bubbling, end to end through `runAction`.
 *
 * The contract (docs/architecture/blocks.md → "Sequencer state schema
 * bubbling"): a block's `sequencerStateSchema` — and one a capability
 * contributes to a sequencer — joins the instance-state contract of the
 * sequencer `ctx.sequencer` resolves to, defaults applied; a sequencer-level
 * `stateSchema` that disagrees with it is refused when the flow is built.
 *
 * Provider-free: every block is a handler, so no model is involved.
 */
import {
  defineCapability,
  defineFlow,
  handler,
  router,
  sequencer,
  SequencerSchemaMismatchError
} from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
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

function flowOf(kind: string, block: Parameters<typeof defineFlow>[0]["actions"][string]["block"]) {
  return defineFlow({ kind, actions: { run: { inputSchema: z.any(), block } } })();
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
    // The sequencer's own default survives, and the child's default is there
    // from the start, not only once someone writes it.
    expect(result.output).toEqual({ label: "x", progress: 0 });
  });

  it("passes through a sequencer that declares no state, to the one that does", async () => {
    // A stateless sequencer is transparent to `ctx.sequencer` (first-party
    // patterns rely on it: debate's per-speaker sub-sequencer, plan-and-
    // execute's seed). Bubbling must not give it a container of its own, or
    // the child's writes would land there instead of on the owner.
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

    // Refused while composing — before defineFlow, and long before any run.
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
});

describe("a checkpoint written before a field bubbled in still restores", () => {
  it("restores the saved fields and fills the new field from its default", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

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
    const stateSchema = z.object({ label: z.string().default("fresh") });

    // v1 is the code that wrote the checkpoint: no block needs `progress`.
    const v1 = defineFlow({
      kind: "bubble-resume",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "durable-owner", inputSchema: z.any(), stateSchema, durable: true })
            .step(write)
            .step(gate)
            .step(reportState)
        }
      }
    })({ id: "bubble-resume" });

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

    // v2 is deployed while the request is suspended: a new step bubbles
    // `progress` (default 5) into the same sequencer.
    const readProgress = handler({
      name: "read-progress",
      inputSchema: z.any(),
      outputSchema: z.any(),
      sequencerStateSchema: z.object({ progress: z.number().default(5) }),
      execute: (input) => input
    });
    const v2 = defineFlow({
      kind: "bubble-resume",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "durable-owner", inputSchema: z.any(), stateSchema, durable: true })
            .step(write)
            .step(gate)
            .tap(readProgress)
            .step(reportState)
        }
      }
    })({ id: "bubble-resume" });

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
