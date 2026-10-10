/**
 * The record limit (FIX-1772): a block's output or a tool's result over
 * `maxRecordedValueBytes` is recorded as one `omitted` placeholder, while the
 * run itself keeps the real value, and a resumed request refuses to compute
 * from a placeholder.
 *
 * Why these matter: a step that returns every file body puts the whole payload
 * into the request log, the stream and later prompts. The limit is the
 * backstop for that misuse. It must never change what the run computes, and a
 * resume must never hand the placeholder on as if it were data.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { BlockTraceItem, OutputItem, ToolOutputItem } from "@flow-state-dev/core/items";
import type { FlowInstance, ResumeContext, SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";

const MARKER = "HELD_OUT_MARKER_7f3c";
const LIMIT = 4096;

/** A payload whose serialized size grows with `n`, carrying a marker at its end. */
function bulk(n: number): { files: Array<{ path: string; body: string }> } {
  return { files: [{ path: "src/index.ts", body: `${"x".repeat(n)}${MARKER}` }] };
}

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

function traceItem(id: string, output: unknown): BlockTraceItem {
  return {
    id,
    type: "block_trace",
    status: "completed",
    requestId: "req_limit",
    itemIndex: 0,
    provenance: { blockName: "reader", blockInstanceId: "req_limit:root:0", phase: "main" },
    ts: 0,
    blockName: "reader",
    blockKind: "handler",
    blockInstanceId: "req_limit:root:0",
    input: { source: { kind: "inline", value: undefined } },
    output
  } as unknown as BlockTraceItem;
}

function toolItem(id: string, fields: Record<string, unknown> = {}): ToolOutputItem {
  return {
    id,
    type: "tool_output",
    status: "in_progress",
    requestId: "req_limit",
    itemIndex: 0,
    provenance: { blockName: "agent", blockInstanceId: "req_limit:root:0", phase: "main" },
    ts: 0,
    blockName: "readFiles",
    output: undefined,
    toolCall: { callId: "c1", name: "readFiles", alias: "readFiles", arguments: "{}", generatorBlock: "agent" },
    ...fields
  } as unknown as ToolOutputItem;
}

const stored = (emitter: ReturnType<typeof createResponseEmitter>, id: string) =>
  emitter.getItems().find((i) => i.id === id) as unknown as Record<string, any>;

describe("the record limit at the response emitter", () => {
  it("records a value at or under the limit byte for byte (BR-1, BR-8)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    // A string serializes with two quote bytes, so this is exactly LIMIT bytes.
    const atLimit = "y".repeat(LIMIT - 2);
    expect(bytesOf(atLimit)).toBe(LIMIT);
    await emitter.emitItemDone(traceItem("t1", { kind: "inline", value: atLimit }));
    expect(stored(emitter, "t1").output).toEqual({ kind: "inline", value: atLimit });
  });

  it("records a value one byte over the limit as the placeholder (BR-2, BR-8)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    const over = "y".repeat(LIMIT - 1);
    const item = traceItem("t1", { kind: "inline", value: over });
    await emitter.emitItemDone(item);

    const output = stored(emitter, "t1").output;
    expect(output).toEqual({ kind: "omitted", bytes: LIMIT + 1, preview: JSON.stringify(over).slice(0, 512) });
    // The caller's object keeps the real value: the run holds references to it.
    expect((item.output as { value: string }).value).toBe(over);
  });

  it("gives the placeholder the exact serialized size and the first 512 characters", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    const value = { note: "héllo ✓", ...bulk(LIMIT * 3), when: new Date(0) };
    await emitter.emitItemDone(traceItem("t1", { kind: "inline", value }));
    const output = stored(emitter, "t1").output;
    expect(output.kind).toBe("omitted");
    expect(output.bytes).toBe(bytesOf(value));
    expect(output.preview).toBe(JSON.stringify(value).slice(0, 512));
    expect(JSON.stringify(emitter.getItems())).not.toContain(MARKER);
  });

  it("limits an inline leaf inside a structure output", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    await emitter.emitItemDone(
      traceItem("t1", {
        kind: "structure",
        shape: {
          container: "object",
          entries: { small: { kind: "inline", value: 1 }, big: { kind: "inline", value: bulk(LIMIT) } }
        }
      })
    );
    const entries = stored(emitter, "t1").output.shape.entries;
    expect(entries.small).toEqual({ kind: "inline", value: 1 });
    expect(entries.big.kind).toBe("omitted");
  });

  it("limits a tool result set by an item.updated patch, on the stored item and the wire (BR-3)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    await emitter.emitItemAdded(toolItem("o1"));
    const big = bulk(LIMIT);
    await emitter.emitItemUpdated("o1", { status: "completed", output: big });

    const item = stored(emitter, "o1");
    expect(item.output).toBeUndefined();
    expect(item.outputOmitted).toEqual({ kind: "omitted", bytes: bytesOf(big), preview: JSON.stringify(big).slice(0, 512) });
    const wire = emitter.getEvents().find((e) => e.type === "item.updated") as unknown as { patch: Record<string, unknown> };
    expect(wire.patch.output).toBeUndefined();
    expect(wire.patch.outputOmitted).toBeDefined();
    expect(JSON.stringify(emitter.getEvents())).not.toContain(MARKER);
  });

  it("omits both result fields when the model-facing text is over the limit (BR-4)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    const modelOutput = `${"m".repeat(LIMIT * 2)}${MARKER}`;
    await emitter.emitItemDone(toolItem("o1", { status: "completed", output: { ok: true }, modelOutput }));
    const item = stored(emitter, "o1");
    expect(item.output).toBeUndefined();
    expect(item.modelOutput).toBeUndefined();
    expect(item.outputOmitted.bytes).toBe(bytesOf(modelOutput));
  });

  it("records an unserializable value as a placeholder with no size, never throwing (BR-7)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    await emitter.emitItemDone(traceItem("t1", { kind: "inline", value: cyclic }));
    await emitter.emitItemDone(toolItem("o1", { status: "completed", output: { n: BigInt(1) } }));
    expect(stored(emitter, "t1").output).toMatchObject({ kind: "omitted", bytes: null });
    expect(stored(emitter, "o1").outputOmitted).toMatchObject({ kind: "omitted", bytes: null });
  });

  it("warns once per replaced value, naming the block, type and size but never the value (BR-9)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    const logged: Array<{ type: string; detail: Record<string, unknown> }> = [];
    emitter.setLogCallback((type, detail) => logged.push({ type, detail }));
    const big = bulk(LIMIT);
    const item = toolItem("o1");
    await emitter.emitItemAdded(item);
    await emitter.emitItemUpdated("o1", { status: "completed", output: big });
    await emitter.emitItemDone({ ...item, status: "completed", output: big } as OutputItem);

    const omitted = logged.filter((l) => l.type === "item.value_omitted");
    expect(omitted).toHaveLength(1);
    expect(omitted[0]!.detail).toMatchObject({ itemType: "tool_output", blockName: "readFiles", bytes: bytesOf(big) });
    expect(JSON.stringify(omitted)).not.toContain(MARKER);
  });

  it("measures a value once, not once per emission", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit", maxRecordedValueBytes: LIMIT });
    let serialized = 0;
    const value = { toJSON: () => { serialized += 1; return bulk(LIMIT); } };
    const item = toolItem("o1");
    await emitter.emitItemAdded(item);
    await emitter.emitItemUpdated("o1", { status: "completed", output: value });
    await emitter.emitItemDone({ ...item, status: "completed", output: value } as OutputItem);
    expect(serialized).toBe(1);
  });

  it("applies 256 KiB when no limit is passed, so every emitter is limited (BR-10)", async () => {
    const emitter = createResponseEmitter({ requestId: "req_limit" });
    const under = "z".repeat(256 * 1024 - 2);
    const over = "z".repeat(256 * 1024 - 1);
    await emitter.emitItemDone(traceItem("t1", { kind: "inline", value: under }));
    await emitter.emitItemDone(traceItem("t2", { kind: "inline", value: over }));
    expect(stored(emitter, "t1").output.kind).toBe("inline");
    expect(stored(emitter, "t2").output.kind).toBe("omitted");
  });
});

// ---------------------------------------------------------------------------
// Through a real run
// ---------------------------------------------------------------------------

const readAll = handler({
  name: "readAll",
  inputSchema: z.object({ n: z.number() }),
  outputSchema: z.any(),
  execute: (input) => bulk(input.n)
});

const measure = handler({
  name: "measure",
  inputSchema: z.any(),
  outputSchema: z.object({ length: z.number(), sawMarker: z.boolean() }),
  execute: (input: { files: Array<{ body: string }> }) => ({
    length: input.files[0]!.body.length,
    sawMarker: input.files[0]!.body.endsWith(MARKER)
  })
});

async function runOnce(flow: FlowInstance, input: unknown, runtimeConfig: Record<string, unknown> = {}) {
  const stores = createInMemoryStores();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: { maxRecordedValueBytes: LIMIT, ...runtimeConfig }
  });
  const record = await stores.request.get(result.requestId!);
  return { result, persisted: (record?.items ?? []) as OutputItem[] };
}

describe("the record limit through runAction", () => {
  it("records the placeholder while the next step gets the full value (BR-2, BR-11)", async () => {
    const flow = defineFlow({
      kind: "limit-step",
      actions: { run: { block: sequencer({ name: "seq" }).step(readAll).step(measure), inputSchema: z.any() } }
    })();
    const { result, persisted } = await runOnce(flow, { n: LIMIT * 2 });

    expect(result.output).toEqual({ length: LIMIT * 2 + MARKER.length, sawMarker: true });
    const trace = persisted.find((i) => i.type === "block_trace" && (i as BlockTraceItem).blockName === "readAll") as BlockTraceItem;
    expect((trace.output as { kind: string }).kind).toBe("omitted");
    expect(JSON.stringify(persisted)).not.toContain(MARKER);
  });

  it("records the placeholder for an .asTool() result (BR-3)", async () => {
    const flow = defineFlow({
      kind: "limit-tool",
      actions: { run: { block: sequencer({ name: "seq" }).step(readAll.asTool()).step(measure), inputSchema: z.any() } }
    })();
    const { result, persisted } = await runOnce(flow, { n: LIMIT * 2 });

    expect(result.output).toMatchObject({ sawMarker: true });
    const tool = persisted.find((i) => i.type === "tool_output") as unknown as Record<string, any>;
    expect(tool.output).toBeUndefined();
    expect(tool.outputOmitted.kind).toBe("omitted");
    expect(JSON.stringify(persisted)).not.toContain(MARKER);
  });

  it("limits a sequencer whose last step is .map (BR-5), and records nothing of a middle .map (BR-6)", async () => {
    const lastMap = defineFlow({
      kind: "limit-last-map",
      actions: {
        run: {
          block: sequencer({ name: "seq" })
            .step(measure.connectInput(() => ({ files: [{ path: "a", body: "small" }] })))
            .map(() => bulk(LIMIT * 2)),
          inputSchema: z.any()
        }
      }
    })();
    const last = await runOnce(lastMap, {});
    expect(last.result.output).toEqual(bulk(LIMIT * 2));
    const seqTrace = last.persisted.find((i) => i.type === "block_trace" && (i as BlockTraceItem).blockName === "seq") as BlockTraceItem;
    expect((seqTrace.output as { kind: string }).kind).toBe("omitted");
    expect(JSON.stringify(last.persisted)).not.toContain(MARKER);

    const middleMap = defineFlow({
      kind: "limit-middle-map",
      actions: {
        run: { block: sequencer({ name: "seq" }).map(() => bulk(LIMIT * 2)).step(measure), inputSchema: z.any() }
      }
    })();
    const middle = await runOnce(middleMap, {});
    expect(middle.result.output).toMatchObject({ sawMarker: true });
    expect(JSON.stringify(middle.persisted)).not.toContain(MARKER);
    expect(JSON.stringify(middle.persisted)).not.toContain('"kind":"omitted"');
  });

  it("uses the runtime's maxRecordedValueBytes (BR-10)", async () => {
    const flow = defineFlow({
      kind: "limit-config",
      actions: { run: { block: sequencer({ name: "seq" }).step(readAll).step(measure), inputSchema: z.any() } }
    })();
    const { persisted } = await runOnce(flow, { n: LIMIT * 2 }, { maxRecordedValueBytes: LIMIT * 4 });
    const trace = persisted.find((i) => i.type === "block_trace" && (i as BlockTraceItem).blockName === "readAll") as BlockTraceItem;
    expect((trace.output as { kind: string }).kind).toBe("inline");
  });
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

function durableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

const approve = handler({
  name: "approve",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
    return input;
  }
});

async function suspendThenApprove(flow: FlowInstance, input: unknown) {
  const { stores, provider } = durableStores();
  const runtimeConfig = { durabilityProvider: provider, maxRecordedValueBytes: LIMIT };
  const initial = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    userId: "u1",
    stores,
    runtimeConfig
  });
  const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
  expect(suspension).toBeDefined();
  await (provider as DurabilityProvider).suspend({ ...suspension!, status: "approved", resolvedAt: Date.now() });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const resumeContext: ResumeContext = { suspensionId: suspension!.suspensionId, action: "approve" };
  const { finished } = await continueRequest({
    requestId: initial.requestId!,
    stores: stores as StoreRegistry,
    flowRegistry: registry,
    resumeContext,
    runtimeConfig
  });
  const resumed = await finished;
  return { resumed, record: await stores.request.get(initial.requestId!) };
}

describe("resuming after a value was recorded as a placeholder", () => {
  it("fails the resumed request with RECORDED_VALUE_OMITTED, naming the step, and never runs the next step (BR-13)", async () => {
    let measured = 0;
    const counted = handler({
      name: "counted",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { files: Array<{ body: string }> }) => {
        measured += 1;
        return { length: input.files[0]!.body.length };
      }
    });
    const flow = defineFlow({
      kind: "limit-resume",
      actions: {
        run: { block: sequencer({ name: "seq", durable: true }).step(readAll).step(approve).step(counted), inputSchema: z.any() }
      }
    })({ id: "limit-resume" });

    const { resumed, record } = await suspendThenApprove(flow, { n: LIMIT * 2 });

    expect(measured).toBe(0);
    expect(record?.status).toBe("failed");
    expect(resumed.output).toBeUndefined();
    expect(resumed.error?.code).toBe("RECORDED_VALUE_OMITTED");
    expect(resumed.error?.message).toContain("readAll");
  });

  it("replays a finished parent whose own output is small, whatever its child recorded (BR-15)", async () => {
    const inner = sequencer({ name: "inner" }).step(readAll).map((v: { files: Array<{ body: string }> }) => ({ length: v.files[0]!.body.length }));
    const flow = defineFlow({
      kind: "limit-small-parent",
      actions: { run: { block: sequencer({ name: "seq", durable: true }).step(inner).step(approve), inputSchema: z.any() } }
    })({ id: "limit-small-parent" });

    const { resumed, record } = await suspendThenApprove(flow, { n: LIMIT * 2 });
    expect(resumed.error).toBeUndefined();
    expect(record?.status).toBe("completed");
    expect(resumed.output).toEqual({ length: LIMIT * 2 + MARKER.length });
  });

  it("resumes a sequence that passed bulk data through a middle .map (BR-16)", async () => {
    const small = handler({ name: "small", inputSchema: z.any(), outputSchema: z.any(), execute: () => ({ n: LIMIT * 2 }) });
    const flow = defineFlow({
      kind: "limit-map-resume",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .step(small)
            .step(approve)
            .map((v: { n: number }) => bulk(v.n))
            .step(measure),
          inputSchema: z.any()
        }
      }
    })({ id: "limit-map-resume" });

    const { resumed, record } = await suspendThenApprove(flow, {});
    expect(resumed.error).toBeUndefined();
    expect(record?.status).toBe("completed");
    expect(resumed.output).toEqual({ length: LIMIT * 2 + MARKER.length, sawMarker: true });
    expect(JSON.stringify(record?.items ?? [])).not.toContain(MARKER);
  });
});
