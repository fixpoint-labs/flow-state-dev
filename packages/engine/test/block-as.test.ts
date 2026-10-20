/**
 * `block.as({ name })` on the real execution path: one name everywhere.
 *
 * A renamed copy shares the original's execute closure, so any builder that
 * quoted the name it was built with would report the original inside the
 * copy's run — in an agent name, a tool attribution, a route record, a step
 * name. These drive `runAction` → suspend → `continueRequest` with in-memory
 * stores and read every name the item log and the suspension records carry.
 *
 * The negative control at the end builds the copy the wrong way — a spread
 * of the definition with only `name` overwritten, no rebuild — and shows the
 * original name leaking, so the positive cases are known to be able to fail.
 */
import { defineFlow, generator, handler, router, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  SuspensionRecord,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, createResponseEmitter, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

/** Keys under which an item or a suspension record names a block. */
const NAME_KEYS = new Set([
  "blockName",
  "agentName",
  "generatorBlock",
  "routerName",
  "selectedRoute",
  "sequencerName",
  "stepName",
  "lastStepName",
  "name",
]);

/** Every string held under a name key, anywhere in `value`. */
function namesIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) namesIn(entry, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (NAME_KEYS.has(key) && typeof entry === "string") into.add(entry);
      namesIn(entry, into);
    }
  }
  return into;
}

/** Copy `block` under `name` — the shipped way, or (control) by spreading. */
type Rename = <T extends BlockDefinition<any, any>>(block: T, name: string) => BlockDefinition<any, any>;
const viaAs: Rename = (block, name) => block.as({ name });
/** The half-rename `.as()` must not be: the old closures keep the old name. */
const viaSpread: Rename = (block, name) => ({ ...block, name }) as BlockDefinition<any, any>;

/** Run `flow` to its first suspension, resolve every pending one until it ends. */
async function runApprovingAll(flow: FlowInstance, input: unknown, action: "approve" | "reject" = "approve") {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const runtimeConfig = { durabilityProvider: provider };
  // Transient items (state snapshots) reach the stream, not the stored log.
  const response = createResponseEmitter({ requestId: "req_block_as", now: () => Date.now() });

  const initial = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: flow as never,
    actionName: "run",
    input,
    userId: "u1",
    stores,
    responseEmitter: response,
    runtimeConfig,
  });
  const requestId = initial.requestId!;
  let result: { output?: unknown; error?: unknown } = initial;
  const seenSuspensions: SuspensionRecord[] = [];
  for (let round = 0; round < 3; round += 1) {
    if ((await stores.request.get(requestId))?.status !== "suspended") break;
    const pending = (await provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
    const [suspension] = pending;
    if (suspension === undefined) break;
    seenSuspensions.push(suspension);
    await provider.suspend({
      ...suspension,
      status: action === "approve" ? "approved" : "rejected",
      resolvedAt: Date.now(),
      resumeData: { ok: true },
    });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension.suspensionId, action, data: { ok: true }, resumedBy: "reviewer" },
      runtimeConfig,
    });
    result = await finished;
  }
  const record = await stores.request.get(requestId);
  return {
    status: record?.status,
    result,
    items: record?.items ?? [],
    names: namesIn([record?.items ?? [], response.getItems(), seenSuspensions]),
    suspensions: seenSuspensions.length,
  };
}

/** Step-capable mock: calls each of `toolNames` on step 0, answers on step 1. */
function callsToolOnce(...toolNames: string[]) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "step-model",
    async generate() {
      throw new Error("legacy generate must not be called");
    },
    async generateStep(options): Promise<GeneratorModelResult> {
      seen.push(options);
      return seen.length === 1
        ? {
            toolCalls: toolNames.map((toolName, index) => ({ toolCallId: `c${index + 1}`, toolName, args: { text: "milk" } })),
            finishReason: "tool-calls",
          }
        : { text: "saved", finishReason: "stop" };
    },
  };
  return { model, seen };
}

/** A tool that asks for approval before its side effect, counted on `runs`. */
function gatedWrite(runs: { writes: number }) {
  return handler({
    name: "notes.write",
    description: "Writes a note.",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ saved: z.string() }),
    execute: async (input, ctx) => {
      await ctx.suspend!({ reason: "approval", message: "Save it?" });
      runs.writes += 1;
      return { saved: input.text };
    },
  });
}

/** A generator, renamed by `rename`, whose one tool suspends for approval. */
function generatorFixture(rename: Rename) {
  const runs = { writes: 0 };
  const { model, seen } = callsToolOnce("notes.write");
  const original = generator({
    name: "orig-assistant",
    model,
    prompt: "p",
    tools: [gatedWrite(runs)],
    // Visible items, so the default agent name (the block's name) is stamped.
    itemVisibility: { client: true, history: true },
  });
  const flow = defineFlow({
    kind: "block-as-generator",
    actions: {
      run: {
        block: sequencer({ name: "root", durable: true }).step(rename(original, "helper")),
        inputSchema: z.any(),
      },
    },
  })() as FlowInstance;
  return { flow, runs, seen };
}

/** A router, renamed by `rename`, whose chosen branch suspends. */
function routerFixture(rename: Rename) {
  const runs = { after: 0 };
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "go on?" }),
  });
  const after = handler({
    name: "after",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => {
      runs.after += 1;
      return "A-final";
    },
  });
  const branchA = sequencer({ name: "branchA" }).step(gate).step(after);
  const branchB = handler({ name: "branchB", inputSchema: z.any(), outputSchema: z.any(), execute: async () => "B" });
  const original = router({
    name: "orig-router",
    routes: [branchA, branchB],
    execute: (input: { which: string }) => (input.which === "a" ? branchA : branchB),
  });
  const flow = defineFlow({
    kind: "block-as-router",
    actions: {
      run: {
        block: sequencer({ name: "root", durable: true }).step(rename(original, "chooser")),
        inputSchema: z.object({ which: z.string() }),
      },
    },
  })() as FlowInstance;
  return { flow, runs };
}

/** A sequencer with an input connector, renamed by `rename`. */
function sequencerFixture(rename: Rename) {
  const sum = handler({
    name: "sum",
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.object({ total: z.number() }),
    execute: (input) => ({ total: input.n + 1 }),
  });
  const original = sequencer({
    name: "orig-pipeline",
    inputSchema: z.object({ n: z.number() }),
    stateSchema: z.object({ seen: z.string().default("") }),
  })
    .step(sum)
    .connectInput(async (raw: { value: string }, ctx) => {
      // A state change, so the connect-input step is snapshotted by name.
      await ctx.sequencer!.patchState({ seen: raw.value } as never);
      return { n: Number(raw.value) };
    });
  const flow = defineFlow({
    kind: "block-as-sequencer",
    actions: {
      run: { block: rename(original, "pipeline"), inputSchema: z.any() },
    },
  })() as FlowInstance;
  return { flow };
}

describe("a renamed copy carries one name on its execution path (BR-7)", () => {
  it("a generator: agent name, tool attribution, approval and trace all name the copy", async () => {
    const { flow, runs } = generatorFixture(viaAs);
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(run.suspensions).toBe(1);
    expect(runs.writes).toBe(1);
    expect(run.names.has("helper")).toBe(true);
    expect(run.names.has("orig-assistant")).toBe(false);

    const tool = run.items.find((i) => i.type === "tool_output") as
      | { toolCall: { generatorBlock?: string } }
      | undefined;
    expect(tool?.toolCall.generatorBlock).toBe("helper");
    const messages = run.items.filter((i) => i.type === "message") as Array<{ agentName?: string }>;
    expect(messages.some((m) => m.agentName === "helper")).toBe(true);
  });

  it("a router: the route record and the resumed branch name the copy", async () => {
    const { flow, runs } = routerFixture(viaAs);
    const run = await runApprovingAll(flow, { which: "a" });

    expect(run.status).toBe("completed");
    expect(run.result.output).toBe("A-final");
    expect(runs.after).toBe(1);
    const decision = run.items.find((i) => i.type === "router_decision") as
      | { routerName: string; provenance: { blockName: string } }
      | undefined;
    expect(decision?.routerName).toBe("chooser");
    expect(decision?.provenance.blockName).toBe("chooser");
    expect(run.names.has("orig-router")).toBe(false);
  });

  it("a sequencer: its trace and its connect-input step name the copy", async () => {
    const { flow } = sequencerFixture(viaAs);
    const run = await runApprovingAll(flow, { value: "4" });

    expect(run.status).toBe("completed");
    expect(run.result.output).toEqual({ total: 5 });
    expect(run.names.has("pipeline")).toBe(true);
    expect(run.names.has("pipeline/connect-input")).toBe(true);
    expect([...run.names].filter((name) => name.startsWith("orig-pipeline"))).toEqual([]);
  });
});

/** Tool-result parts the model was handed on a step, by tool name. */
function toolResultsSeen(options: GeneratorModelCallOptions | undefined): Array<{ toolName: string; output: unknown }> {
  const out: Array<{ toolName: string; output: unknown }> = [];
  for (const message of (options?.messages ?? []) as Array<Record<string, unknown>>) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push({ toolName: part.toolName as string, output: part.output });
    }
  }
  return out;
}

/** A generator whose tools are `tools`, which the model calls in order on step 0. */
function toolFlow(kind: string, toolNames: string[], tools: BlockDefinition<any, any>[]) {
  const { model, seen } = callsToolOnce(...toolNames);
  const agent = generator({ name: "assistant", model, prompt: "p", tools });
  const flow = defineFlow({
    kind,
    actions: { run: { block: sequencer({ name: "root", durable: true }).step(agent), inputSchema: z.any() } },
  })() as FlowInstance;
  return { flow, seen };
}

describe("a renamed tool that asks before it runs (BR-9, BR-10)", () => {
  it("suspends and resumes under the new name, and its side effect happens once", async () => {
    const runs = { writes: 0 };
    const { flow, seen } = toolFlow("block-as-tool-approve", ["saveNote"], [
      gatedWrite(runs).as({ name: "saveNote", description: "Save a note for the person." }),
    ]);
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(run.suspensions).toBe(1);
    expect(runs.writes).toBe(1);
    // Every tool_output for the call (the suspended one and the completed one)
    // names the copy; exactly one completed.
    const tools = run.items.filter((i) => i.type === "tool_output") as Array<{ status: string; toolCall: { name: string } }>;
    expect(new Set(tools.map((t) => t.toolCall.name))).toEqual(new Set(["saveNote"]));
    expect(tools.filter((t) => t.status === "completed")).toHaveLength(1);
    expect(toolResultsSeen(seen[1]).map((r) => r.toolName)).toEqual(["saveNote"]);
    expect(run.names.has("notes.write")).toBe(false);
  });

  it("hands a denial to the model under the new name", async () => {
    const runs = { writes: 0 };
    const { flow, seen } = toolFlow("block-as-tool-deny", ["saveNote"], [gatedWrite(runs).as({ name: "saveNote" })]);
    const run = await runApprovingAll(flow, {}, "reject");

    expect(run.status).toBe("completed");
    expect(runs.writes).toBe(0);
    const results = toolResultsSeen(seen[1]);
    expect(results.map((r) => r.toolName)).toEqual(["saveNote"]);
    expect(JSON.stringify(results[0]?.output)).toContain("denied");
    expect(run.names.has("notes.write")).toBe(false);
  });
});

describe("the original beside its copy (BR-8)", () => {
  it("keeps its own name in its own items and trace rows", async () => {
    let writes = 0;
    const original = handler({
      name: "notes.write",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ saved: z.string() }),
      execute: (input) => {
        writes += 1;
        return { saved: input.text };
      },
    });
    const { flow } = toolFlow("block-as-beside", ["notes.write", "saveNote"], [original, original.as({ name: "saveNote" })]);
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(writes).toBe(2);
    const byCall = Object.fromEntries(
      (run.items.filter((i) => i.type === "tool_output") as Array<{ toolCall: { callId: string; name: string } }>).map(
        (t) => [t.toolCall.callId, t.toolCall.name],
      ),
    );
    expect(byCall).toEqual({ c1: "notes.write", c2: "saveNote" });
    const traces = run.items.filter((i) => i.type === "block_trace") as Array<{ blockName: string; blockInstanceId: string }>;
    const originalRows = traces.filter((t) => t.blockName === "notes.write");
    const copyRows = traces.filter((t) => t.blockName === "saveNote");
    expect(originalRows).toHaveLength(1);
    expect(copyRows).toHaveLength(1);
    expect(originalRows[0]!.blockInstanceId).not.toBe(copyRows[0]!.blockInstanceId);
  });
});

describe("state, routes and lookups by the copy (BR-11, BR-12)", () => {
  it("keeps a renamed block's own state under the copy's name", async () => {
    const original = handler({
      name: "orig-counter",
      inputSchema: z.any(),
      outputSchema: z.any(),
      stateSchema: z.object({ count: z.number().default(0) }),
      execute: async (_input, ctx) => {
        await ctx.self!.setState({ count: ctx.self!.state.count + 1 });
        return ctx.self!.state.count;
      },
    });
    const flow = defineFlow({
      kind: "block-as-state",
      actions: {
        run: { block: sequencer({ name: "root" }).step(original.as({ name: "tally" })), inputSchema: z.any() },
      },
    })() as FlowInstance;
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(run.result.output).toBe(1);
    const writes = run.items.filter((i) => i.type === "state_change") as Array<{ provenance: { blockName: string } }>;
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w.provenance.blockName === "tally")).toBe(true);
    expect(run.names.has("orig-counter")).toBe(false);
  });

  it("records and resumes a renamed route by the copy's name", async () => {
    const runs = { after: 0 };
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => ctx.suspend!({ reason: "human_approval", message: "go on?" }),
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        runs.after += 1;
        return "done";
      },
    });
    const fast = sequencer({ name: "orig-branch" }).step(gate).step(after).as({ name: "fast" });
    const slow = handler({ name: "slow", inputSchema: z.any(), outputSchema: z.any(), execute: async () => "slow" });
    const decide = router({ name: "decide", routes: [fast, slow], execute: () => fast });
    const flow = defineFlow({
      kind: "block-as-route",
      actions: { run: { block: sequencer({ name: "root", durable: true }).step(decide), inputSchema: z.any() } },
    })() as FlowInstance;
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(run.result.output).toBe("done");
    expect(runs.after).toBe(1);
    const decision = run.items.find((i) => i.type === "router_decision") as { selectedRoute: string } | undefined;
    expect(decision?.selectedRoute).toBe("fast");
    expect(run.names.has("orig-branch")).toBe(false);
  });

  it("matches ctx.wasRescued by the copy, never by the original", async () => {
    const seen: Record<string, boolean> = {};
    const flaky = handler({
      name: "orig-flaky",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("boom");
      },
    });
    const fallback = handler({ name: "fallback", inputSchema: z.any(), outputSchema: z.any(), execute: () => "recovered" });
    const steady = flaky.rescue([{ block: fallback }]).as({ name: "steady" });
    const check = handler({
      name: "check",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input, ctx) => {
        seen.byCopy = ctx.wasRescued(steady);
        seen.byName = ctx.wasRescued("steady");
        seen.byOriginal = ctx.wasRescued(flaky);
        return input;
      },
    });
    const flow = defineFlow({
      kind: "block-as-rescued",
      actions: { run: { block: sequencer({ name: "root" }).step(steady).step(check), inputSchema: z.any() } },
    })() as FlowInstance;
    const run = await runApprovingAll(flow, {});

    expect(run.status).toBe("completed");
    expect(seen).toEqual({ byCopy: true, byName: true, byOriginal: false });
  });
});

describe("negative control: a copy that only overwrites `name` (no rebuild)", () => {
  // The positives above can fail: a spread copy keeps the original's closures,
  // and the original's name leaks out of them. If the run path handed execute
  // the receiver instead of the definition it built, these would go green.
  it("leaks the original's name from a generator", async () => {
    const { flow } = generatorFixture(viaSpread);
    const run = await runApprovingAll(flow, {});
    expect(run.names.has("orig-assistant")).toBe(true);
  });

  it("leaks the original's name from a router", async () => {
    const { flow } = routerFixture(viaSpread);
    const run = await runApprovingAll(flow, { which: "a" });
    expect(run.names.has("orig-router")).toBe(true);
  });
});
