import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BlockConfig } from "../src/types/block";
import { buildBlock } from "../src/blocks/internal/build-block";
import { asRuntime } from "../src/types/block";
import {
  defineCapability,
  defineFlow,
  defineResource,
  dispatcher,
  evaluator,
  generator,
  handler,
  RouteUnavailableError,
  router,
  sequencer,
  SequencerOutputSchemaError
} from "../src";
import { buildReplayLog } from "../src/blocks/internal/replay-log";
import type { RuntimeItem } from "../src/items/internal";
import type { GeneratorModel, GeneratorModelCallOptions } from "../src/types/model";
import { createMockContext, runForTest } from "./helpers";
class RetryableError extends Error {}
class FatalError extends Error {}

describe("buildBlock", () => {
  it("requires a non-empty block name", () => {
    const config = {
      name: "",
      execute: () => "ok"
    } as unknown as BlockConfig;

    expect(() =>
      buildBlock({
        kind: "handler",
        config
      })
    ).toThrow("non-empty");
  });

  it("requires an execute function", () => {
    expect(() =>
      buildBlock({
        kind: "handler",
        config: { name: "missing-execute" } as BlockConfig
      })
    ).toThrow("without an execute function");
  });

  it("validates input and output schemas", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "validated",
        inputSchema: z.object({ count: z.number() }),
        outputSchema: z.object({ total: z.number() }),
        execute: (input: { count: number }) => ({ total: input.count + 1 })
      }
    });

    const ctx = createMockContext();
    await expect(runForTest(block, { count: 1 }, ctx)).resolves.toEqual({ total: 2 });
    await expect(runForTest(block, { count: "bad" } as unknown as { count: number }, ctx)).rejects.toThrow(
      "input validation failed"
    );
  });

  it("keeps config.execute as user logic and exposes framework behavior via run()", async () => {
    const execute = vi.fn((input: { count: number }) => ({ total: input.count + 1 }));
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "raw-execute",
        inputSchema: z.object({ count: z.number() }),
        outputSchema: z.object({ total: z.number() }),
        execute
      }
    });

    const ctx = createMockContext();
    expect(
      block.config.execute?.({ count: "bad" } as unknown as { count: number }, ctx)
    ).toEqual({ total: "bad1" });
    await expect(runForTest(block, { count: "bad" } as unknown as { count: number }, ctx)).rejects.toThrow(
      "input validation failed"
    );
  });

  it("supports connectInput and connectOutput", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "math",
        execute: (value) => value * 2
      }
    })
      .connectInput((value: string) => Number(value))
      .connectOutput((value) => `n:${value}`);

    const ctx = createMockContext();
    await expect(runForTest(block, "4", ctx)).resolves.toBe("n:8");
  });

  it("connectInput preserves declaredResources", () => {
    const resources = {
      session: { myResource: { stateSchema: z.object({ x: z.number() }) } }
    };
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-resources",
        execute: (value) => value
      },
      declaredResources: resources
    });

    expect(block.declaredResources).toBe(resources);

    const connected = block.connectInput((value: string) => Number(value));
    expect(connected.declaredResources).toBe(resources);
  });

  it("connectOutput preserves declaredResources", () => {
    const resources = {
      session: { myResource: { stateSchema: z.object({ x: z.number() }) } }
    };
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-resources",
        execute: (value) => value
      },
      declaredResources: resources
    });

    const connected = block.connectOutput((value) => `n:${value}`);
    expect(connected.declaredResources).toBe(resources);
  });

  it("propagates errors without retry (server owns retry)", async () => {
    let attempts = 0;
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "no-retry",
        execute: () => {
          attempts += 1;
          throw new RetryableError("try again");
        }
      }
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("try again");
    expect(attempts).toBe(1);
  });

  it("mapModelOutput stashes the mapper without changing run() output", async () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "rich",
        execute: (value: number) => ({ items: [{ id: "a", v: value }], n: 1 })
      }
    });

    const mapped = block.mapModelOutput((out) => `n=${out.n}`);

    // Schemas are preserved.
    expect(mapped.outputSchema).toBe(block.outputSchema);
    expect(mapped.inputSchema).toBe(block.inputSchema);

    // The structured output continues to flow through the substrate's run().
    const ctx = createMockContext();
    await expect(runForTest(mapped, 5, ctx)).resolves.toEqual({
      items: [{ id: "a", v: 5 }],
      n: 1
    });

    // The original block has no mapper; the mapped clone carries it.
    expect(asRuntime(block)._modelOutputMapper).toBeUndefined();
    const mapper = asRuntime(mapped)._modelOutputMapper;
    expect(mapper).toBeDefined();
    await expect(Promise.resolve(mapper!({ items: [], n: 3 } as never, ctx))).resolves.toBe("n=3");
  });

  it("connectInput preserves an installed mapModelOutput mapper", () => {
    // `connectInput` keeps `TOutputSchema`, so any mapper installed via
    // `mapModelOutput` is still type-valid against the rebuilt block. The
    // rebuild must forward it through.
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "with-mapper",
        execute: (n: number) => ({ doubled: n * 2 })
      }
    }).mapModelOutput((out) => `doubled=${out.doubled}`);

    const reshaped = block.connectInput((s: string) => Number(s));
    expect(asRuntime(reshaped)._modelOutputMapper).toBeDefined();
  });

  it("connectOutput drops mapModelOutput (output type changes)", () => {
    const block = buildBlock({
      kind: "handler",
      config: {
        name: "drop-mapper",
        execute: (n: number) => ({ doubled: n * 2 })
      }
    }).mapModelOutput((out) => `doubled=${out.doubled}`);

    const reshaped = block.connectOutput((out) => out.doubled);
    expect(asRuntime(reshaped)._modelOutputMapper).toBeUndefined();
  });

  it("calls lifecycle hooks", async () => {
    const onCompleted = vi.fn();
    const onErrored = vi.fn();
    const ctx = createMockContext();

    const okBlock = buildBlock({
      kind: "handler",
      config: {
        name: "ok",
        onCompleted,
        execute: (value) => value + 1
      }
    });

    await expect(runForTest(okBlock, 1, ctx)).resolves.toBe(2);
    expect(onCompleted).toHaveBeenCalledWith(2, ctx, undefined);

    const failingBlock = buildBlock({
      kind: "handler",
      config: {
        name: "fail",
        onErrored,
        execute: () => {
          throw "boom";
        }
      }
    });

    await expect(runForTest(failingBlock, 1, ctx)).rejects.toThrow("boom");
    expect(onErrored).toHaveBeenCalledTimes(1);
    expect(onErrored.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

/**
 * `block.as({ name, description })` — a copy of a block under a new name for
 * the model. The new name is the copy's only name; the original is untouched.
 */
describe("BlockDefinition.as", () => {
  /** A step-capable mock that calls `toolName` once, then answers. */
  function callsTool(toolName: string, args: Record<string, unknown>) {
    const seen: GeneratorModelCallOptions[] = [];
    const model: GeneratorModel = {
      modelId: "step-model",
      async generate() {
        throw new Error("not used");
      },
      async generateStep(options) {
        seen.push(options);
        return seen.length === 1
          ? { toolCalls: [{ toolCallId: "c1", toolName, args }], finishReason: "tool-calls" }
          : { text: "done", finishReason: "stop" };
      }
    };
    return { model, seen };
  }

  const writeNote = () =>
    handler({
      name: "notes.write",
      description: "Writes a note to the store.",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ saved: z.boolean() }),
      execute: () => ({ saved: true })
    });

  it("offers the model the new name and description, with the original's input schema (BR-1)", async () => {
    const original = writeNote();
    const { model, seen } = callsTool("saveNote", { text: "hi" });
    const agent = generator({
      name: "assistant",
      model,
      prompt: "p",
      tools: [original.as({ name: "saveNote", description: "Save a note for the person." })]
    });

    await expect(runForTest(agent, {}, createMockContext())).resolves.toBe("done");
    const offered = seen[0]!.tools ?? [];
    expect(offered.map((t) => t.name)).toEqual(["saveNote"]);
    expect(offered[0]!.description).toBe("Save a note for the person.");
    expect(offered[0]!.parameters).toBe(original.inputSchema);
  });

  it("replaces only the description when no name is given (BR-2)", () => {
    const original = writeNote();
    const copy = original.as({ description: "Keep this for later." });
    expect(copy.name).toBe("notes.write");
    expect(copy.description).toBe("Keep this for later.");
  });

  it("keeps the original's description when only a name is given (BR-3)", () => {
    const copy = writeNote().as({ name: "saveNote" });
    expect(copy.name).toBe("saveNote");
    expect(copy.description).toBe("Writes a note to the store.");
  });

  it("makes two tools of two copies, each call attributed to the name the model called (BR-4)", async () => {
    let runs = 0;
    const original = handler({
      name: "notes.write",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ saved: z.boolean() }),
      execute: () => {
        runs += 1;
        return { saved: true };
      }
    });
    const seen: GeneratorModelCallOptions[] = [];
    const model: GeneratorModel = {
      modelId: "step-model",
      async generate() {
        throw new Error("not used");
      },
      async generateStep(options) {
        seen.push(options);
        return seen.length === 1
          ? {
              toolCalls: [
                { toolCallId: "c1", toolName: "saveNote", args: { text: "a" } },
                { toolCallId: "c2", toolName: "keepNote", args: { text: "b" } }
              ],
              finishReason: "tool-calls"
            }
          : { text: "done", finishReason: "stop" };
      }
    };
    const emitted: Array<{ type: string; item?: { type?: string; toolCall?: { name: string; callId: string } } }> = [];
    const ctx = createMockContext({
      response: { emit: (event: unknown) => emitted.push(event as never), getItems: () => [] } as never
    });
    const agent = generator({
      name: "assistant",
      model,
      prompt: "p",
      tools: [original.as({ name: "saveNote" }), original.as({ name: "keepNote" })]
    });

    await runForTest(agent, {}, ctx);
    expect((seen[0]!.tools ?? []).map((t) => t.name).sort()).toEqual(["keepNote", "saveNote"]);
    expect(runs).toBe(2);
    const calls = new Map(
      emitted
        .filter((e) => e.type === "item.added" && e.item?.type === "tool_output")
        .map((e) => [e.item!.toolCall!.callId, e.item!.toolCall!.name] as const)
    );
    expect(Object.fromEntries(calls)).toEqual({ c1: "saveNote", c2: "keepNote" });
  });

  it("refuses a copy whose name another tool in the list already has (BR-5)", async () => {
    const other = handler({ name: "saveNote", execute: () => ({}) });
    const { model } = callsTool("saveNote", { text: "hi" });
    const agent = generator({
      name: "assistant",
      model,
      prompt: "p",
      tools: [writeNote().as({ name: "saveNote" }), other]
    });
    await expect(runForTest(agent, {}, createMockContext())).rejects.toThrow(/saveNote/);
  });

  it("refuses a blank or whitespace name when the copy is built (BR-6)", () => {
    expect(() => writeNote().as({ name: "" })).toThrow(/non-empty "name"/);
    expect(() => writeNote().as({ name: "   " })).toThrow(/non-empty "name"/);
  });

  describe("carries everything but the name and description (BR-13)", () => {
    const store = defineResource({ scope: "session", stateSchema: z.object({ n: z.number() }) });

    it("the input connector", async () => {
      const copy = handler({
        name: "double",
        inputSchema: z.object({ n: z.number() }),
        execute: (input: { n: number }) => input.n * 2
      })
        .connectInput((raw: string) => ({ n: Number(raw) }))
        .as({ name: "twice" });
      await expect(runForTest(copy, "4" as never, createMockContext())).resolves.toBe(8);
    });

    it("the model-output mapper", () => {
      const copy = writeNote().mapModelOutput(() => "saved").as({ name: "saveNote" });
      expect(asRuntime(copy)._modelOutputMapper).toBeDefined();
    });

    it("rescue handlers, which still recover the copy", async () => {
      const fallback = handler({ name: "fallback", execute: () => "recovered" });
      const copy = handler({
        name: "flaky",
        execute: () => {
          throw new Error("boom");
        }
      })
        .rescue([{ block: fallback }])
        .as({ name: "steady" });
      await expect(runForTest(copy, {}, createMockContext())).resolves.toBe("recovered");
      expect(copy.childBlocks).toContain(fallback);
    });

    it("declared resources, which still reach the flow through the copy", () => {
      const original = handler({ name: "counter", resources: { store }, execute: () => ({}) });
      const copy = original.as({ name: "tally" });
      expect(copy.declaredResources).toEqual(original.declaredResources);
      expect(copy.ownDeclaredResources).toEqual(original.ownDeclaredResources);
      const flow = defineFlow({ kind: "as-resources", actions: { run: { block: copy } } }) as unknown as {
        resources?: Record<string, unknown>;
      };
      expect(flow.resources?.store).toBe(store);
    });

    it("capabilities, whose accessors the copy still builds", async () => {
      const greeter = defineCapability({ name: "greeter", fns: () => ({ hello: () => "hi" }) });
      const copy = handler({
        name: "greet",
        uses: [greeter],
        execute: (_input, ctx) => (ctx as unknown as { cap: { greeter: { hello(): string } } }).cap.greeter.hello()
      }).as({ name: "salute" });
      await expect(runForTest(copy, {}, createMockContext())).resolves.toBe("hi");
    });

    it("a dispatch address", () => {
      const copy = dispatcher({
        name: "wake-epic",
        type: "internal",
        action: "wake",
        session: { id: () => "s_epic" }
      }).as({ name: "wake" });
      expect(copy.dispatch).toEqual({ type: "internal", action: "wake" });
    });

    it("a flow-config requirement, which the flow still refuses to leave unmet", () => {
      const copy = handler({
        name: "regional",
        flowConfigSchema: z.object({ region: z.string() }),
        execute: () => ({})
      }).as({ name: "local" });
      expect(() => defineFlow({ kind: "as-config", actions: { run: { block: copy } } })).toThrow(
        /block "local", which requires flow config/
      );
    });

    it("a sequencer's reported output schema, and its steps", async () => {
      const out = z.object({ total: z.number() });
      const step = handler({ name: "sum", outputSchema: out, execute: () => ({ total: 3 }) });
      const chain = sequencer({ name: "chain" }).step(step);
      const copy = chain.as({ name: "summed" });
      expect(copy.outputSchema).toBe(out);
      expect(copy.config.outputSchema).toBe(out);
      expect(copy.childBlocks).toContain(step);
      await expect(runForTest(copy, {}, createMockContext())).resolves.toEqual({ total: 3 });
    });

    it("a generator's static tools", () => {
      const { model } = callsTool("x", {});
      const tool = writeNote();
      const copy = generator({ name: "assistant", model, prompt: "p", tools: [tool] }).as({ name: "helper" });
      expect(copy.staticTools).toEqual([tool]);
    });

    it("never changes the original", () => {
      const original = writeNote();
      original.as({ name: "saveNote", description: "other" });
      expect(original.name).toBe("notes.write");
      expect(original.description).toBe("Writes a note to the store.");
      expect(original.config.name).toBe("notes.write");
    });
  });

  describe("composes with the other rebuilds in either order (BR-14)", () => {
    const base = () =>
      handler({
        name: "double",
        inputSchema: z.object({ n: z.number() }),
        execute: (input: { n: number }) => {
          if (input.n < 0) throw new Error("negative");
          return input.n * 2;
        }
      });
    const connector = (raw: string) => ({ n: Number(raw) });
    const fallback = handler({ name: "fallback", execute: () => 0 });

    it("connectInput", async () => {
      const a = base().as({ name: "twice" }).connectInput(connector);
      const b = base().connectInput(connector).as({ name: "twice" });
      for (const block of [a, b]) {
        expect(block.name).toBe("twice");
        await expect(runForTest(block, "5" as never, createMockContext())).resolves.toBe(10);
      }
    });

    it("mapModelOutput", () => {
      const mapper = () => "mapped";
      const a = base().as({ name: "twice" }).mapModelOutput(mapper);
      const b = base().mapModelOutput(mapper).as({ name: "twice" });
      for (const block of [a, b]) {
        expect(block.name).toBe("twice");
        expect(asRuntime(block)._modelOutputMapper).toBe(mapper);
      }
    });

    it("rescue", async () => {
      const a = base().as({ name: "twice" }).rescue([{ block: fallback }]);
      const b = base().rescue([{ block: fallback }]).as({ name: "twice" });
      for (const block of [a, b]) {
        expect(block.name).toBe("twice");
        await expect(runForTest(block, { n: -1 }, createMockContext())).resolves.toBe(0);
      }
    });
  });

  describe("names the copy, never the original, in what it reports while running (BR-7)", () => {
    it("a router's RouteUnavailableError on resume", async () => {
      const low = handler({ name: "low", execute: () => "low" });
      const high = handler({ name: "high", execute: () => "high" });
      const copy = router({ name: "orig-route", routes: [low, high], execute: () => high }).as({ name: "triage" });
      const decision = {
        id: "decision_root",
        type: "router_decision",
        status: "completed",
        requestId: "req_1",
        itemIndex: 0,
        provenance: { blockName: "triage", blockInstanceId: "req_1:root:0", phase: "main" },
        ts: 0,
        routerName: "triage",
        selectedRoute: "low"
      } as RuntimeItem;
      const ctx = createMockContext({ _replayLog: buildReplayLog([decision]) } as never);

      const error = await runForTest(copy, {}, ctx).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(RouteUnavailableError);
      expect((error as RouteUnavailableError).details.routerName).toBe("triage");
    });

    it("a sequencer's output validation error", async () => {
      const copy = sequencer({ name: "orig-chain", outputSchema: z.object({ total: z.number() }) })
        .step(handler({ name: "wrong", execute: () => ({ total: "three" }) }))
        .as({ name: "summed" });
      const error = await runForTest(copy, {}, createMockContext()).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(SequencerOutputSchemaError);
      expect((error as SequencerOutputSchemaError).details.sequencerName).toBe("summed");
    });

    it("an evaluator's refusal of the questions it computed", async () => {
      const copy = evaluator({
        name: "orig-grader",
        model: "openai/gpt-5.4-mini",
        questions: () => ({}) as never
      }).as({ name: "grader" });
      const error = (await runForTest(copy, {}, createMockContext()).catch((thrown: unknown) => thrown)) as Error;
      expect(error.message).toContain('Evaluator "grader"');
      expect(error.message).not.toContain("orig-grader");
    });
  });
});

