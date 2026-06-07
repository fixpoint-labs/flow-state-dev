import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "../src";
import type { BlockContext } from "../src/types/block";
import { SequencerOutputSchemaError, SequencerSchemaMismatchError, SuspensionError } from "../src";
import { defineResource } from "../src/types/resource";
import { createMockContext, runForTest } from "./helpers";
function addHandler(name: string, delta = 1) {
  return handler({
    name,
    inputSchema: z.number(),
    outputSchema: z.number(),
    execute: (value) => value + delta
  });
}

describe("sequencer builder", () => {
  it("supports step and connector overload", async () => {
    const one = addHandler("one", 1);
    const two = addHandler("two", 2);
    const chain = sequencer({ name: "then-chain", inputSchema: z.number() })
      .step(one)
      .step((value) => value * 2, two);

    const ctx = createMockContext();
    await expect(runForTest(chain, 1, ctx)).resolves.toBe(6);
  });

  it("supports stepIf", async () => {
    const plusTen = addHandler("plus-ten", 10);
    const seq = sequencer({ name: "then-if", inputSchema: z.number() })
      .stepIf((value) => value > 0, plusTen)
      .stepIf((value) => value > 100, (value) => value, plusTen);

    const ctx = createMockContext();
    await expect(runForTest(seq, 1, ctx)).resolves.toBe(11);
  });

  it("supports map", async () => {
    const seq = sequencer({ name: "map-step", inputSchema: z.number() }).map((value) => `v:${value}`);
    const ctx = createMockContext();
    await expect(runForTest(seq, 3, ctx)).resolves.toBe("v:3");
  });

  it("supports parallel", async () => {
    const seq = sequencer({ name: "parallel-step", inputSchema: z.number() }).parallel({
      left: addHandler("left", 1),
      right: {
        connector: (value) => value * 2,
        block: addHandler("right", 3)
      }
    });

    const ctx = createMockContext();
    await expect(runForTest(seq, 2, ctx)).resolves.toEqual({
      left: 3,
      right: 7
    });
  });

  it("supports forEach and connector overload", async () => {
    const plusTwo = addHandler("plus-two", 2);

    const direct = sequencer({ name: "for-each-direct", inputSchema: z.array(z.number()) }).forEach(plusTwo);
    const viaConnector = sequencer({ name: "for-each-connector", inputSchema: z.number() }).forEach(
      (value) => [value, value + 1],
      plusTwo
    );

    const ctx = createMockContext();
    await expect(runForTest(direct, [1, 2], ctx)).resolves.toEqual([3, 4]);
    await expect(runForTest(viaConnector, 2, ctx)).resolves.toEqual([4, 5]);
  });

  it("supports doUntil and doWhile", async () => {
    const inc = addHandler("inc", 1);
    const untilSeq = sequencer({ name: "until", inputSchema: z.number() }).doUntil((value) => value >= 3, inc);
    const whileSeq = sequencer({ name: "while", inputSchema: z.number() }).doWhile((value) => value < 3, inc);

    const ctx = createMockContext();
    await expect(runForTest(untilSeq, 0, ctx)).resolves.toBe(3);
    await expect(runForTest(whileSeq, 0, ctx)).resolves.toBe(3);
  });

  it("supports loopBack", async () => {
    const inc = addHandler("inc", 1);
    const seq = sequencer({ name: "loop-back", inputSchema: z.number() })
      .step(inc)
      .loopBack("inc", {
        when: (value) => (value as number) < 3,
        maxIterations: 5
      });

    const ctx = createMockContext();
    await expect(runForTest(seq, 0, ctx)).resolves.toBe(3);
  });

  it("gives loopBack re-executions distinct child blockInstanceIds per iteration (FIX-643)", async () => {
    const inc = addHandler("inc", 1);
    const seq = sequencer({ name: "loop-id", inputSchema: z.number() })
      .step(inc)
      .loopBack("inc", {
        when: (value) => (value as number) < 3,
        maxIterations: 5
      });

    const capturedIncIds: string[] = [];
    const ctx = createMockContext();
    (ctx as any)._withExecutionScope = async (
      parent: { name: string; instanceId: string; path: string },
      execute: (c: BlockContext) => Promise<unknown>
    ) => {
      if (parent.name === "inc") {
        capturedIncIds.push(parent.instanceId);
      }
      const childCtx = {
        ...ctx,
        _blockIdentity: { blockName: parent.name, blockInstanceId: parent.instanceId, blockPath: parent.path }
      } as BlockContext;
      return execute(childCtx);
    };

    await expect(runForTest(seq, 0, ctx)).resolves.toBe(3);

    // The executor body runs 3 times (0→1→2→3). Each re-execution after a
    // loopBack jump must get a distinct identity so the DevTool renders one
    // row per iteration instead of collapsing them.
    expect(capturedIncIds).toHaveLength(3);
    expect(new Set(capturedIncIds).size).toBe(3);
    // Generation 0 (first pass) is segment-free; later passes carry loop[N].
    expect(capturedIncIds[0]).not.toContain("loop[");
    expect(capturedIncIds[1]).toContain("loop[1]");
    expect(capturedIncIds[2]).toContain("loop[2]");
  });

  it("supports work and waitForWork", async () => {
    const workBlock = handler({
      name: "bg-work",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (value) => value + 10
    });

    const seq = sequencer({ name: "work-flow", inputSchema: z.number() })
      .work(workBlock)
      .waitForWork({ failOnError: true });

    const ctx = createMockContext();
    await expect(runForTest(seq, 1, ctx)).resolves.toBe(1);
  });

  it("waitForWork can fail on background errors", async () => {
    const failingWork = handler({
      name: "failing-work",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("background failure");
      }
    });

    const seq = sequencer({ name: "work-fail", inputSchema: z.number() })
      .work(failingWork)
      .waitForWork({ failOnError: true });

    const ctx = createMockContext();
    await expect(runForTest(seq, 1, ctx)).rejects.toThrow("background failure");
  });

  it("emits structured status options during auto-await of work tasks", async () => {
    const statusCalls: Array<{ message: string | undefined; options?: { blocked?: boolean; backgroundTasks?: number } }> = [];
    const slowWork = handler({
      name: "slow-work",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (v) => {
        await new Promise((r) => setTimeout(r, 10));
        return v;
      }
    });
    const fastWork = handler({
      name: "fast-work",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (v) => v
    });

    const seq = sequencer({ name: "status-meta", inputSchema: z.number() })
      .work(slowWork)
      .work(fastWork);

    const ctx = createMockContext({
      emitStatus: (message: string | undefined, options?: { blocked?: boolean; backgroundTasks?: number }) => {
        statusCalls.push({ message, options });
      }
    });

    await runForTest(seq, 1, ctx);

    // First status: unblock client, report total background tasks
    expect(statusCalls[0]!.options?.blocked).toBe(false);
    expect(statusCalls[0]!.options?.backgroundTasks).toBe(2);
    // Final status: all background tasks done
    const last = statusCalls[statusCalls.length - 1]!;
    expect(last.options?.blocked).toBe(false);
    expect(last.options?.backgroundTasks).toBe(0);
  });

  describe("forEachBackground", () => {
    it("dispatches iterations as background work and returns immediately", async () => {
      const executed: number[] = [];
      const processItem = handler({
        name: "process-item",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          executed.push(value);
          return value * 2;
        }
      });

      const seq = sequencer({ name: "bg-foreach", inputSchema: z.array(z.number()) })
        .forEachBackground(processItem)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      // The sequencer's output should be the original input (pass-through), not the mapped results
      const result = await runForTest(seq, [1, 2, 3], ctx);
      expect(result).toEqual([1, 2, 3]);
      // All items should have been processed in the background
      expect(executed.sort()).toEqual([1, 2, 3]);
    });

    it("supports connector overload", async () => {
      const executed: string[] = [];
      const processItem = handler({
        name: "process-str",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: async (value) => {
          executed.push(value);
          return value.toUpperCase();
        }
      });

      const seq = sequencer({ name: "bg-foreach-conn", inputSchema: z.number() })
        .forEachBackground(
          (value) => [String(value), String(value + 1)],
          processItem
        )
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 5, ctx);
      expect(result).toBe(5);
      expect(executed.sort()).toEqual(["5", "6"]);
    });

    it("isolates iteration failures from the parent", async () => {
      const executed: number[] = [];
      const sometimesFails = handler({
        name: "maybe-fail",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          if (value === 2) throw new Error("item 2 failed");
          executed.push(value);
          return value;
        }
      });

      // Without failOnError, the parent should succeed even though one iteration fails
      const seq = sequencer({ name: "bg-foreach-isolated", inputSchema: z.array(z.number()) })
        .forEachBackground(sometimesFails)
        .waitForWork({ failOnError: false });

      const ctx = createMockContext();
      const result = await runForTest(seq, [1, 2, 3], ctx);
      expect(result).toEqual([1, 2, 3]);
      // Items 1 and 3 should have run; item 2 threw but didn't stop the others
      expect(executed.sort()).toEqual([1, 3]);
    });

    it("propagates failures when waitForWork has failOnError", async () => {
      const failingBlock = handler({
        name: "always-fail",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("iteration failure"); }
      });

      const seq = sequencer({ name: "bg-foreach-fail", inputSchema: z.array(z.number()) })
        .forEachBackground(failingBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await expect(runForTest(seq, [1], ctx)).rejects.toThrow("iteration failure");
    });

    it("respects concurrency limit", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      const trackConcurrency = handler({
        name: "track",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          currentConcurrent += 1;
          if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
          // Yield to event loop to allow other tasks to run
          await new Promise((r) => setTimeout(r, 5));
          currentConcurrent -= 1;
          return value;
        }
      });

      const seq = sequencer({ name: "bg-foreach-conc", inputSchema: z.array(z.number()) })
        .forEachBackground(trackConcurrency, { concurrency: 2 })
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await runForTest(seq, [1, 2, 3, 4, 5], ctx);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("supports dynamic block factory", async () => {
      const executed: string[] = [];
      const doubler = handler({
        name: "doubler",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => { executed.push(`double:${value}`); return value * 2; }
      });
      const tripler = handler({
        name: "tripler",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => { executed.push(`triple:${value}`); return value * 3; }
      });

      const seq = sequencer({ name: "bg-foreach-factory", inputSchema: z.array(z.number()) })
        .forEachBackground((item: number, index) => index % 2 === 0 ? doubler : tripler)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await runForTest(seq, [10, 20, 30], ctx);
      expect(executed.sort()).toEqual(["double:10", "double:30", "triple:20"]);
    });
  });

  it("supports tap and tapIf", async () => {
    const tapped: number[] = [];
    const tapBlock = handler({
      name: "tap-block",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => {
        tapped.push(value);
        return value;
      }
    });

    const seq = sequencer({ name: "tap-seq", inputSchema: z.number() })
      .tap((value) => {
        tapped.push(value + 1);
      })
      .tap((value) => value * 2, tapBlock)
      .tapIf((value) => value > 0, (value) => {
        tapped.push(value + 2);
      })
      .tapIf((value) => value > 0, (value) => value * 3, tapBlock);

    const ctx = createMockContext();
    await expect(runForTest(seq, 2, ctx)).resolves.toBe(2);
    expect(tapped).toEqual([3, 4, 4, 6]);
  });

  it("supports rescue", async () => {
    const failing = handler({
      name: "failing",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("broken");
      }
    });

    const rescueBlock = handler({
      name: "rescue-handler",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: (error: Error) => `recovered:${error.message}`
    });

    const seq = sequencer({ name: "rescue-seq", inputSchema: z.number() })
      .step(failing)
      .rescue([{ block: rescueBlock }]);

    const ctx = createMockContext();
    await expect(runForTest(seq, 1, ctx)).resolves.toBe("recovered:broken");
  });

  it("sets the internal _didRescue flag on ctx when a rescue handler recovers", async () => {
    const failing = handler({
      name: "failing-flag",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("broken");
      }
    });
    const rescueBlock = handler({
      name: "rescue-flag-handler",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: (error: Error) => `recovered:${error.message}`
    });
    const seq = sequencer({ name: "rescue-flag-seq", inputSchema: z.number() })
      .step(failing)
      .rescue([{ block: rescueBlock }]);

    const ctx = createMockContext();
    await runForTest(seq, 1, ctx);
    expect((ctx as { _didRescue?: boolean })._didRescue).toBe(true);
  });

  it("leaves _didRescue unset when no rescue fires", async () => {
    const ok = handler({
      name: "ok-no-rescue",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });
    const seq = sequencer({ name: "no-rescue-flag-seq", inputSchema: z.number() })
      .step(ok)
      .rescue([{ block: ok }]);

    const ctx = createMockContext();
    await runForTest(seq, 1, ctx);
    expect((ctx as { _didRescue?: boolean })._didRescue).toBeUndefined();
  });

  it("supports branch and throws when no branch matches", async () => {
    const small = handler({
      name: "small",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: () => "small"
    });
    const large = handler({
      name: "large",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: () => "large"
    });

    const branching = sequencer({ name: "branching", inputSchema: z.number() }).branch({
      small: [(value) => value, (value) => value < 10, small],
      large: [(value) => value, (value) => value >= 10, large]
    });

    const none = sequencer({ name: "branch-none", inputSchema: z.number() }).branch({
      never: [(value) => value, () => false, small]
    });

    const ctx = createMockContext();
    await expect(runForTest(branching, 12, ctx)).resolves.toBe("large");
    await expect(runForTest(none, 1, ctx)).rejects.toThrow("no matching route");
  });

  describe("inline block definitions", () => {
    it("supports step(handler, config) basic execution", async () => {
      const seq = sequencer({ name: "inline-then", inputSchema: z.number() }).step(handler, {
        outputSchema: z.string(),
        execute: (input: number) => `value:${input}`
      });

      const ctx = createMockContext();
      await expect(runForTest(seq, 42, ctx)).resolves.toBe("value:42");
    });

    it("injects inputSchema from previous step's outputSchema", async () => {
      const parseNumber = handler({
        name: "parse",
        inputSchema: z.string(),
        outputSchema: z.number(),
        execute: (value) => Number(value)
      });

      const seq = sequencer({ name: "schema-injection", inputSchema: z.string() })
        .step(parseNumber)
        .step(handler, {
          outputSchema: z.string(),
          execute: (input: number) => `#${input}`
        });

      const ctx = createMockContext();
      await expect(runForTest(seq, "7", ctx)).resolves.toBe("#7");
    });

    it("auto-generates name when name omitted", async () => {
      const seq = sequencer({ name: "auto-name", inputSchema: z.number() }).step(handler, {
        outputSchema: z.number(),
        execute: (input: number) => input * 2
      });

      const ctx = createMockContext();
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(10);
    });

    it("uses provided name when name is given", async () => {
      const seq = sequencer({ name: "named-inline", inputSchema: z.number() }).step(handler, {
        name: "my-doubler",
        outputSchema: z.number(),
        execute: (input: number) => input * 2
      });

      const ctx = createMockContext();
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(10);
    });

    it("supports chained inline blocks", async () => {
      const seq = sequencer({ name: "chained-inline", inputSchema: z.number() })
        .step(handler, {
          outputSchema: z.object({ doubled: z.number() }),
          execute: (input: number) => ({ doubled: input * 2 })
        })
        .step(handler, {
          outputSchema: z.string(),
          execute: (input: { doubled: number }) => `result:${input.doubled}`
        });

      const ctx = createMockContext();
      await expect(runForTest(seq, 5, ctx)).resolves.toBe("result:10");
    });

    it("supports tap(handler, config) side effect", async () => {
      const sideEffects: number[] = [];

      const seq = sequencer({ name: "inline-tap", inputSchema: z.number() })
        .step(handler, {
          outputSchema: z.number(),
          execute: (input: number) => input * 3
        })
        .tap(handler, {
          execute: (input: number) => {
            sideEffects.push(input);
          }
        });

      const ctx = createMockContext();
      const result = await runForTest(seq, 4, ctx);
      expect(result).toBe(12);
      expect(sideEffects).toEqual([12]);
    });

    it("supports stepIf(condition, handler, config) conditional", async () => {
      const seq = sequencer({ name: "inline-then-if", inputSchema: z.number() })
        .stepIf((value) => value > 10, handler, {
          outputSchema: z.string(),
          execute: (input: number) => `big:${input}`
        });

      const ctx = createMockContext();
      // Condition not met — passthrough
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(5);
      // Condition met — inline block runs
      await expect(runForTest(seq, 15, ctx)).resolves.toBe("big:15");
    });

    it("supports mixed inline + pre-defined blocks", async () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const seq = sequencer({ name: "mixed-chain", inputSchema: z.number() })
        .step(addOne)
        .step(handler, {
          outputSchema: z.number(),
          execute: (input: number) => input * 10
        })
        .step(addOne);

      const ctx = createMockContext();
      // (5 + 1) * 10 + 1 = 61
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(61);
    });

    it("falls back to z.any() when no previous schema is available", async () => {
      // First step in chain — no previous block to inherit from
      const seq = sequencer({ name: "no-prev-schema", inputSchema: z.number() }).step(handler, {
        outputSchema: z.string(),
        execute: (input: number) => `first:${input}`
      });

      const ctx = createMockContext();
      await expect(runForTest(seq, 99, ctx)).resolves.toBe("first:99");
    });
  });

  describe("schema propagation", () => {
    it("propagates outputSchema from the last step", () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const seq = sequencer({ name: "output-prop", inputSchema: z.number() }).step(addOne);

      // The sequencer's outputSchema should reflect the last step (z.number()), not z.any()
      expect((seq.outputSchema as any)._def?.typeName).toBe("ZodNumber");
    });

    it("updates outputSchema as the chain grows", () => {
      const toStr = handler({
        name: "to-str",
        inputSchema: z.number(),
        outputSchema: z.string(),
        execute: (value) => String(value)
      });
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const step1 = sequencer({ name: "chain-prop", inputSchema: z.number() }).step(addOne);
      expect((step1.outputSchema as any)._def?.typeName).toBe("ZodNumber");

      const step2 = step1.step((value: number) => value, toStr);
      expect((step2.outputSchema as any)._def?.typeName).toBe("ZodString");
    });

    it("infers inputSchema from first block when not explicitly provided", () => {
      const parseStr = handler({
        name: "parse",
        inputSchema: z.string(),
        outputSchema: z.number(),
        execute: (value) => Number(value)
      });

      // No inputSchema on sequencer — should infer from first block
      const seq = sequencer({ name: "input-infer" }).step(parseStr);
      expect((seq.inputSchema as any)._def?.typeName).toBe("ZodString");
    });

    it("preserves explicit inputSchema over first-block inference", () => {
      const parseStr = handler({
        name: "parse",
        inputSchema: z.string(),
        outputSchema: z.number(),
        execute: (value) => Number(value)
      });

      // Explicit inputSchema should be preserved, not overridden by first block
      const seq = sequencer({ name: "input-explicit", inputSchema: z.number() })
        .step((value: number) => String(value), parseStr);
      expect((seq.inputSchema as any)._def?.typeName).toBe("ZodNumber");
    });

    it("builds composite z.object schema from parallel()", () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });
      const toStr = handler({
        name: "to-str",
        inputSchema: z.number(),
        outputSchema: z.string(),
        execute: (value) => String(value)
      });

      const seq = sequencer({ name: "parallel-schema", inputSchema: z.number() }).parallel({
        num: addOne,
        str: { connector: (value: number) => value, block: toStr }
      });

      const outputDef = (seq.outputSchema as any)._def;
      expect(outputDef?.typeName).toBe("ZodObject");
      const shape = outputDef?.shape?.();
      expect(shape?.num?._def?.typeName).toBe("ZodNumber");
      expect(shape?.str?._def?.typeName).toBe("ZodString");
    });

    it("builds z.array schema from forEach()", () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const seq = sequencer({ name: "forEach-schema", inputSchema: z.array(z.number()) })
        .forEach(addOne);

      const outputDef = (seq.outputSchema as any)._def;
      expect(outputDef?.typeName).toBe("ZodArray");
      expect(outputDef?.type?._def?.typeName).toBe("ZodNumber");
    });

    it("falls back to z.any after map() since lambdas have no schema", () => {
      const seq = sequencer({ name: "map-schema", inputSchema: z.number() })
        .map((value: number) => `mapped:${value}`);

      // map() uses a lambda — no schema to propagate
      expect((seq.outputSchema as any)._def?.typeName).toBe("ZodAny");
    });

  });

  describe("connectInput", () => {
    it("returns a SequencerDefinition with DSL methods", () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "ci-dsl", inputSchema: z.number() })
        .step(addOne);

      const connected = seq.connectInput((s: string) => Number(s));

      // Should have sequencer DSL methods — not a bare BlockDefinition
      expect(typeof connected.step).toBe("function");
      expect(typeof connected.tap).toBe("function");
      expect(typeof connected.map).toBe("function");
      expect(typeof connected.work).toBe("function");
      expect(connected.kind).toBe("sequencer");
    });

    it("mapper runs before sequencer operations", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "ci-mapper", inputSchema: z.number() })
        .step(addOne);

      const connected = seq.connectInput((s: string) => Number(s));
      const ctx = createMockContext();
      // "5" → 5 → 5 + 1 = 6
      await expect(runForTest(connected, "5", ctx)).resolves.toBe(6);
    });

    it("preserves declared resources from child blocks", () => {
      const resource = defineResource({
        ref: "myResource",
        scope: "session",
        stateSchema: z.object({ items: z.array(z.string()) })
      });

      const step = handler({
        name: "step-with-resource",
        inputSchema: z.number(),
        outputSchema: z.number(),
        resources: { myResource: resource },
        execute: (v) => v
      });

      const seq = sequencer({ name: "ci-resources", inputSchema: z.number() })
        .step(step);

      const connected = seq.connectInput((s: string) => Number(s));

      expect(connected.declaredResources).toEqual({ myResource: resource });
    });

    it("supports chaining DSL methods after connectInput", async () => {
      const addOne = addHandler("add-one", 1);
      const double = handler({
        name: "double",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (v) => v * 2
      });

      const connected = sequencer({ name: "ci-chain", inputSchema: z.number() })
        .step(addOne)
        .connectInput((s: string) => Number(s))
        .step(double);

      const ctx = createMockContext();
      // "3" → 3 → 3 + 1 = 4 → 4 * 2 = 8
      await expect(runForTest(connected, "3", ctx)).resolves.toBe(8);
    });

    it("preserves name from original sequencer config", () => {
      const seq = sequencer({ name: "my-seq", inputSchema: z.number() })
        .step(addHandler("step", 1));

      const connected = seq.connectInput((s: string) => Number(s));
      expect(connected.name).toBe("my-seq");
    });
  });

  describe("stepAll", () => {
    it("runs blocks concurrently and returns ordered array", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);
      const addThree = addHandler("add-three", 3);

      const seq = sequencer({ name: "then-all", inputSchema: z.number() })
        .stepAll([addOne, addTwo, addThree]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 10, ctx)).resolves.toEqual([11, 12, 13]);
    });

    it("supports connector steps", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);

      const seq = sequencer({ name: "then-all-conn", inputSchema: z.number() })
        .stepAll([
          addOne,
          { connector: (value: number) => value * 2, block: addTwo },
        ]);

      const ctx = createMockContext();
      // addOne: 5 + 1 = 6; connector: 5 * 2 = 10, addTwo: 10 + 2 = 12
      await expect(runForTest(seq, 5, ctx)).resolves.toEqual([6, 12]);
    });

    it("propagates first error on failure", async () => {
      const addOne = addHandler("add-one", 1);
      const failing = handler({
        name: "fail",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("boom"); },
      });

      const seq = sequencer({ name: "then-all-fail", inputSchema: z.number() })
        .stepAll([addOne, failing]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("boom");
    });

    it("respects maxConcurrency", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const slowBlock = handler({
        name: "slow",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (v) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent -= 1;
          return v;
        },
      });

      const seq = sequencer({ name: "then-all-conc", inputSchema: z.number() })
        .stepAll([slowBlock, slowBlock, slowBlock, slowBlock], { maxConcurrency: 2 });

      const ctx = createMockContext();
      await runForTest(seq, 1, ctx);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("returns empty array for empty blocks", async () => {
      const seq = sequencer({ name: "then-all-empty", inputSchema: z.number() })
        .stepAll([]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).resolves.toEqual([]);
    });

    it("collects resources from child blocks", () => {
      const resource = defineResource({
        ref: "myResource",
        scope: "session",
        stateSchema: z.object({ items: z.array(z.string()) }),
      });

      const step = handler({
        name: "res-step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        resources: { myResource: resource },
        execute: (v) => v,
      });

      const seq = sequencer({ name: "then-all-res", inputSchema: z.number() })
        .stepAll([step]);

      expect(seq.declaredResources).toEqual({ myResource: resource });
    });
  });

  describe("stepAny", () => {
    it("returns first successful result (sequential)", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);

      const seq = sequencer({ name: "then-any", inputSchema: z.number() })
        .stepAny([addOne, addTwo]);

      const ctx = createMockContext();
      // Sequential: addOne runs first and succeeds → returns its result, addTwo never runs
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(6);
    });

    it("skips failed blocks and returns first success", async () => {
      const failing = handler({
        name: "fail",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("boom"); },
      });

      const success = handler({
        name: "success",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (v) => v + 42,
      });

      const seq = sequencer({ name: "then-any-skip", inputSchema: z.number() })
        .stepAny([failing, success]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(43);
    });

    it("does not execute blocks after first success", async () => {
      let secondRan = false;

      const first = handler({
        name: "first",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (v) => v + 1,
      });

      const second = handler({
        name: "second",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (v) => { secondRan = true; return v + 2; },
      });

      const seq = sequencer({ name: "then-any-skip-rest", inputSchema: z.number() })
        .stepAny([first, second]);

      const ctx = createMockContext();
      await runForTest(seq, 5, ctx);
      expect(secondRan).toBe(false);
    });

    it("throws AggregateError when all blocks fail", async () => {
      const fail1 = handler({
        name: "fail-1",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("error-1"); },
      });

      const fail2 = handler({
        name: "fail-2",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("error-2"); },
      });

      const seq = sequencer({ name: "then-any-all-fail", inputSchema: z.number() })
        .stepAny([fail1, fail2]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("All blocks in stepAny failed");
    });

    it("throws AggregateError with empty blocks array", async () => {
      const seq = sequencer({ name: "then-any-empty", inputSchema: z.number() })
        .stepAny([]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("stepAny called with no blocks");
    });

    it("works with a single block", async () => {
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "then-any-single", inputSchema: z.number() })
        .stepAny([addOne]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(6);
    });
  });

  describe("race", () => {
    it("resolves with first successful result", async () => {
      const slow = handler({
        name: "slow",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (v) => {
          await new Promise((r) => setTimeout(r, 50));
          return v + 100;
        },
      });

      const fast = handler({
        name: "fast",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (v) => v + 1,
      });

      const seq = sequencer({ name: "race-success", inputSchema: z.number() })
        .race([slow, fast]);

      const ctx = createMockContext();
      // fast succeeds first → returns 6
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(6);
    });

    it("skips failures and returns first success", async () => {
      const slow = handler({
        name: "slow",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (v) => {
          await new Promise((r) => setTimeout(r, 50));
          return v + 100;
        },
      });

      const fastFail = handler({
        name: "fast-fail",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("fast failure"); },
      });

      const seq = sequencer({ name: "race-skip-fail", inputSchema: z.number() })
        .race([slow, fastFail]);

      const ctx = createMockContext();
      // fastFail completes first but fails → slow succeeds → returns 101
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(101);
    });

    it("throws AggregateError when all blocks fail", async () => {
      const fail1 = handler({
        name: "fail-1",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("error-1"); },
      });

      const fail2 = handler({
        name: "fail-2",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => { throw new Error("error-2"); },
      });

      const seq = sequencer({ name: "race-all-fail", inputSchema: z.number() })
        .race([fail1, fail2]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("All blocks in race failed");
    });

    it("throws on empty blocks array", async () => {
      const seq = sequencer({ name: "race-empty", inputSchema: z.number() })
        .race([]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("race called with no blocks");
    });

    it("single block completes normally", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "race-single", inputSchema: z.number() })
        .race([addOne]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 10, ctx)).resolves.toBe(11);
    });

    it("respects maxConcurrency", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const slowBlock = handler({
        name: "slow",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (v) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent -= 1;
          return v;
        },
      });

      const seq = sequencer({ name: "race-conc", inputSchema: z.number() })
        .race([slowBlock, slowBlock, slowBlock, slowBlock], { maxConcurrency: 2 });

      const ctx = createMockContext();
      await runForTest(seq, 1, ctx);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("collects resources from all race blocks", () => {
      const resource = defineResource({
        ref: "myResource",
        scope: "session",
        stateSchema: z.object({ count: z.number() }),
      });

      const step = handler({
        name: "res-step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        resources: { myResource: resource },
        execute: (v) => v,
      });

      const seq = sequencer({ name: "race-res", inputSchema: z.number() })
        .race([step]);

      expect(seq.declaredResources).toEqual({ myResource: resource });
    });
  });

  describe("exitIf", () => {
    it("exits chain when condition is true", async () => {
      const addTen = addHandler("add-ten", 10);
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "exit-true", inputSchema: z.number() })
        .step(addTen)
        .exitIf((value) => value > 5)
        .step(addOne);

      const ctx = createMockContext();
      // 0 + 10 = 10, exitIf(10 > 5) → exits, skips addOne
      await expect(runForTest(seq, 0, ctx)).resolves.toBe(10);
    });

    it("continues chain when condition is false", async () => {
      const addTen = addHandler("add-ten", 10);
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "exit-false", inputSchema: z.number() })
        .step(addTen)
        .exitIf((value) => value > 100)
        .step(addOne);

      const ctx = createMockContext();
      // 0 + 10 = 10, exitIf(10 > 100) → false, continues → 10 + 1 = 11
      await expect(runForTest(seq, 0, ctx)).resolves.toBe(11);
    });

    it("supports async conditions", async () => {
      const seq = sequencer({ name: "exit-async", inputSchema: z.number() })
        .exitIf(async (value) => value === 42);

      const ctx = createMockContext();
      await expect(runForTest(seq, 42, ctx)).resolves.toBe(42);
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(1);
    });

    it("uses context in condition", async () => {
      const seq = sequencer({ name: "exit-ctx", inputSchema: z.number() })
        .exitIf((_value, ctx) => ctx.request.identity.id === "req_1");

      const ctx = createMockContext();
      // condition checks ctx.request.identity.id === "req_1" → true → exits
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(5);
    });

    it("works with background work — per-sequencer fallback auto-awaits when no request pool is present", async () => {
      // Without `_requestWorkPool` on ctx (the unit-test default), sequencer
      // DSL falls back to the legacy per-sequencer auto-await so dispatcher
      // tests don't need to construct a pool. The request-scoped pool
      // behavior — inner sequencers do NOT block their parent — is asserted
      // at the integration level (see packages/integration-tests).
      let workRan = false;
      const sideEffect = handler({
        name: "side-effect",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (v) => {
          await new Promise((r) => setTimeout(r, 10));
          workRan = true;
          return v;
        },
      });

      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "exit-work", inputSchema: z.number() })
        .work(sideEffect)
        .exitIf((value) => value > 0)
        .step(addOne);

      const ctx = createMockContext();
      const result = await runForTest(seq, 5, ctx);
      expect(result).toBe(5);
      expect(workRan).toBe(true);
    });

    it("multiple exitIf in chain — first match wins", async () => {
      const addOne = addHandler("add-one", 1);
      const addTen = addHandler("add-ten", 10);

      const seq = sequencer({ name: "exit-multi", inputSchema: z.number() })
        .step(addOne)
        .exitIf((value) => value > 3)
        .step(addTen)
        .exitIf((value) => value > 50)
        .step(addOne);

      const ctx = createMockContext();
      // 5 + 1 = 6, exitIf(6 > 3) → true → exits with 6
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(6);
      // 1 + 1 = 2, exitIf(2 > 3) → false → 2 + 10 = 12, exitIf(12 > 50) → false → 12 + 1 = 13
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(13);
    });
  });

  describe("throwIf", () => {
    class GuardError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "GuardError";
      }
    }

    it("throws the supplied static error when condition is true", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "throw-static", inputSchema: z.number() })
        .step(addOne)
        .throwIf((value) => value > 0, new GuardError("positive"))
        .step(addOne);

      const ctx = createMockContext();
      await expect(runForTest(seq, 0, ctx)).rejects.toThrow("positive");
    });

    it("invokes the error factory with value + ctx and throws its result", async () => {
      const seq = sequencer({ name: "throw-factory", inputSchema: z.number() })
        .throwIf(
          (value) => value === 42,
          (value, ctx) =>
            new GuardError(`bad value ${value} on ${ctx.request.identity.id}`),
        );

      const ctx = createMockContext();
      await expect(runForTest(seq, 42, ctx)).rejects.toThrow(
        /^bad value 42 on /,
      );
    });

    it("passes through unchanged when condition is false", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "throw-pass", inputSchema: z.number() })
        .step(addOne)
        .throwIf((value) => value > 100, new GuardError("never"))
        .step(addOne);

      const ctx = createMockContext();
      await expect(runForTest(seq, 0, ctx)).resolves.toBe(2);
    });

    it("supports async conditions and async error factories", async () => {
      const seq = sequencer({ name: "throw-async", inputSchema: z.number() })
        .throwIf(
          async (value) => value === 7,
          async (value) => new GuardError(`async ${value}`),
        );

      const ctx = createMockContext();
      await expect(runForTest(seq, 7, ctx)).rejects.toThrow("async 7");
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(1);
    });

    it("is caught by .rescue with matching `when:` filter", async () => {
      const fallback = handler({
        name: "fallback",
        inputSchema: z.unknown(),
        outputSchema: z.number(),
        execute: async () => -1,
      });

      const seq = sequencer({ name: "throw-rescue", inputSchema: z.number() })
        .throwIf((value) => value > 0, new GuardError("tripped"))
        .rescue([{ when: [GuardError], block: fallback }]);

      const ctx = createMockContext();
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(-1);
    });
  });

  describe("workIf", () => {
    it("dispatches sidechain when condition function returns true", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          workExecuted = true;
          return value + 10;
        }
      });

      const seq = sequencer({ name: "workIf-true", inputSchema: z.number() })
        .workIf(() => true, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 1, ctx);
      expect(result).toBe(1);
      expect(workExecuted).toBe(true);
    });

    it("skips sidechain when condition function returns false", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          workExecuted = true;
          return value + 10;
        }
      });

      const seq = sequencer({ name: "workIf-false", inputSchema: z.number() })
        .workIf(() => false, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 1, ctx);
      expect(result).toBe(1);
      expect(workExecuted).toBe(false);
    });

    it("accepts static boolean true (equivalent to work())", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          workExecuted = true;
          return value + 10;
        }
      });

      const seq = sequencer({ name: "workIf-static-true", inputSchema: z.number() })
        .workIf(true, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 1, ctx);
      expect(result).toBe(1);
      expect(workExecuted).toBe(true);
    });

    it("accepts static boolean false (complete no-op)", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          workExecuted = true;
          return value + 10;
        }
      });

      const seq = sequencer({ name: "workIf-static-false", inputSchema: z.number() })
        .workIf(false, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 1, ctx);
      expect(result).toBe(1);
      expect(workExecuted).toBe(false);
    });

    it("condition receives the running value and BlockContext", async () => {
      let receivedValue: unknown = null;
      let receivedCtx: unknown = null;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => value
      });

      const seq = sequencer({ name: "workIf-ctx", inputSchema: z.number() })
        .workIf((value, ctx) => {
          receivedValue = value;
          receivedCtx = ctx;
          return true;
        }, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await runForTest(seq, 1, ctx);
      expect(receivedValue).toBe(1);
      expect(receivedCtx).not.toBeNull();
      expect((receivedCtx as any).request).toBeDefined();
    });

    it("condition can gate dispatch on the running value", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: async (value) => {
          workExecuted = true;
          return value;
        }
      });

      const seq = sequencer({ name: "workIf-value", inputSchema: z.string() })
        .workIf((value) => value.length > 0, workBlock)
        .waitForWork({ failOnError: true });

      // Empty string fails the predicate — work should not run.
      const ctx = createMockContext();
      await runForTest(seq, "", ctx);
      expect(workExecuted).toBe(false);

      // Non-empty satisfies it.
      await runForTest(seq, "hello", ctx);
      expect(workExecuted).toBe(true);
    });

    it("supports async condition functions", async () => {
      let workExecuted = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => {
          workExecuted = true;
          return value + 10;
        }
      });

      const seq = sequencer({ name: "workIf-async", inputSchema: z.number() })
        .workIf(async () => {
          await new Promise((r) => setTimeout(r, 5));
          return true;
        }, workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 1, ctx);
      expect(result).toBe(1);
      expect(workExecuted).toBe(true);
    });

    it("supports connector overload", async () => {
      const executed: string[] = [];
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: async (value) => {
          executed.push(value);
          return value.toUpperCase();
        }
      });

      const seq = sequencer({ name: "workIf-conn", inputSchema: z.number() })
        .workIf(
          () => true,
          (value) => String(value),
          workBlock
        )
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      const result = await runForTest(seq, 42, ctx);
      expect(result).toBe(42);
      expect(executed).toEqual(["42"]);
    });

    it("does not dispatch connector when condition is false", async () => {
      let connectorCalled = false;
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: async (value) => value
      });

      const seq = sequencer({ name: "workIf-no-conn", inputSchema: z.number() })
        .workIf(
          () => false,
          (value) => {
            connectorCalled = true;
            return String(value);
          },
          workBlock
        )
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await runForTest(seq, 42, ctx);
      expect(connectorCalled).toBe(false);
    });

    it("returns original value unchanged (fire-and-forget)", async () => {
      const workBlock = handler({
        name: "bg-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => value * 100
      });

      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "workIf-passthrough", inputSchema: z.number() })
        .workIf(() => true, workBlock)
        .step(addOne);

      const ctx = createMockContext();
      // workIf returns unchanged value (5), then addOne → 6
      await expect(runForTest(seq, 5, ctx)).resolves.toBe(6);
    });

    it("propagates sidechain failures via waitForWork failOnError", async () => {
      const failingWork = handler({
        name: "failing-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => {
          throw new Error("conditional background failure");
        }
      });

      const seq = sequencer({ name: "workIf-fail", inputSchema: z.number() })
        .workIf(() => true, failingWork)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow("conditional background failure");
    });

    it("does not surface a public stream item when a background work task fails (auto-await)", async () => {
      // Rejected background tasks are logged. The failed `block_output` reaches
      // the DevTool via the trace channel; nothing surfaces as a public stream
      // item. Parent action still completes successfully.
      const failingWork = handler({
        name: "background-failing-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => {
          throw new Error("background failure");
        }
      });

      const emitted: Array<{ type: string; item: { type: string; message?: string; blockName?: string } }> = [];
      const ctx = createMockContext({
        response: {
          emit: (event: { type: string; item: any }) => {
            if (event.type === "item.added") {
              emitted.push(event);
            }
            return undefined;
          }
        } as any
      });

      const seq = sequencer({ name: "work-step-error", inputSchema: z.number() })
        .workIf(() => true, failingWork);

      await expect(runForTest(seq, 1, ctx)).resolves.toBe(1);

      const stepError = emitted.find((e) => e.item.type === "step_error");
      expect(stepError).toBeUndefined();
    });
  });

  describe("output schema validation", () => {
    // --- Runtime gate ---

    it("returns the value when the tail matches the declared schema", async () => {
      const seq = sequencer({
        name: "rt-happy",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).map((n) => `v:${n}`);

      const ctx = createMockContext();
      await expect(runForTest(seq, 3, ctx)).resolves.toBe("v:3");
    });

    it("throws SequencerOutputSchemaError when the tail mismatches the declared schema", async () => {
      const seq = sequencer({
        name: "rt-mismatch",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).map((n) => n + 1);

      const ctx = createMockContext();
      const err = await runForTest(seq, 1, ctx).catch((e) => e);
      expect(err).toBeInstanceOf(SequencerOutputSchemaError);
      expect(err.code).toBe("sequencer_output_schema_error");
      expect(err.details.sequencerName).toBe("rt-mismatch");
      expect(err.details.rawOutput).toBe(2);
      expect(err.details.issues.length).toBeGreaterThan(0);
    });

    it("validates the exitIf early-exit value against the declared schema", async () => {
      const seq = sequencer({
        name: "rt-exit",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.number() })
      }).exitIf(() => true);

      const ctx = createMockContext();
      // exitIf returns the input (a number) before any step shapes it into {a}.
      const err = await runForTest(seq, 5, ctx).catch((e) => e);
      expect(err).toBeInstanceOf(SequencerOutputSchemaError);
      // No step mutated state, so lastStepName stays the initial sentinel.
      expect(err.details.lastStepName).toBe("__initial__");
    });

    it("validates the rescue recovery value and attributes the rescue block name", async () => {
      const failing = handler({
        name: "failing",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: () => {
          throw new Error("boom");
        }
      });
      const rescueNum = handler({
        name: "rescue-num",
        inputSchema: z.any(),
        outputSchema: z.number(),
        execute: () => 99
      });

      const seq = sequencer({
        name: "rt-rescue",
        inputSchema: z.number(),
        outputSchema: z.string()
      })
        .step(failing)
        .rescue([{ block: rescueNum }]);

      const ctx = createMockContext();
      const err = await runForTest(seq, 1, ctx).catch((e) => e);
      expect(err).toBeInstanceOf(SequencerOutputSchemaError);
      expect(err.details.lastStepName).toBe("rescue-num");
      expect(err.details.rawOutput).toBe(99);
    });

    it("incurs no validation when outputSchema is omitted", async () => {
      const seq = sequencer({ name: "rt-none", inputSchema: z.number() }).map((n) => n + 1);
      const ctx = createMockContext();
      // Value passes through untouched — behaviour identical to a schema-less chain.
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(2);
    });

    it("is rescue-catchable from a parent sequencer via when: [SequencerOutputSchemaError]", async () => {
      const child = sequencer({
        name: "child",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).map((n) => n + 1); // number out, fails the string gate

      const fallback = handler({
        name: "fallback",
        inputSchema: z.any(),
        outputSchema: z.string(),
        execute: () => "recovered"
      });

      const parent = sequencer({
        name: "parent",
        inputSchema: z.number(),
        outputSchema: z.string()
      })
        .step(child)
        .rescue([{ when: [SequencerOutputSchemaError], block: fallback }]);

      const ctx = createMockContext();
      await expect(runForTest(parent, 1, ctx)).resolves.toBe("recovered");
    });

    it("re-validates a rescued value against the parent's declared schema", async () => {
      const child = sequencer({
        name: "child-bad",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).map((n) => n + 1);

      const badFallback = handler({
        name: "bad-fallback",
        inputSchema: z.any(),
        outputSchema: z.number(),
        execute: () => 0
      });

      const parent = sequencer({
        name: "parent-bad",
        inputSchema: z.number(),
        outputSchema: z.string()
      })
        .step(child)
        .rescue([{ when: [SequencerOutputSchemaError], block: badFallback }]);

      const ctx = createMockContext();
      // Rescue catches the child's failure, but the fallback's number output
      // fails the parent's string gate — the chokepoint fires again.
      await expect(runForTest(parent, 1, ctx)).rejects.toThrow(SequencerOutputSchemaError);
    });

    it("returns the post-transform value when the schema uses .transform()", async () => {
      const seq = sequencer({
        name: "rt-transform",
        inputSchema: z.number(),
        outputSchema: z.string().transform((s) => Number(s))
      }).map(() => "42");

      const ctx = createMockContext();
      await expect(runForTest(seq, 1, ctx)).resolves.toBe(42);
    });

    it("runs async refinements in the runtime gate", async () => {
      const seq = sequencer({
        name: "rt-async-refine",
        inputSchema: z.number(),
        outputSchema: z.string().refine(async (s) => s.length > 3, "too short")
      }).map((n) => `${n}`);

      const ctx = createMockContext();
      // "1" has length 1 — the async refine must run and reject (safeParse would skip it).
      await expect(runForTest(seq, 1, ctx)).rejects.toThrow(SequencerOutputSchemaError);
      // "12345" satisfies the async refine.
      await expect(runForTest(seq, 12345, ctx)).resolves.toBe("12345");
    });

    // --- Build-time .validate() ---

    const strBlock = handler({
      name: "to-str",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: (n) => `${n}`
    });

    it(".validate() passes when declared and inferred schemas match", () => {
      const seq = sequencer({
        name: "bt-match",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).step(strBlock);
      expect(() => seq.validate()).not.toThrow();
    });

    it(".validate() fast-paths reference-equal schemas", () => {
      const schema = z.string();
      const sharedBlock = handler({
        name: "shared",
        inputSchema: z.number(),
        outputSchema: schema,
        execute: (n) => `${n}`
      });
      const seq = sequencer({
        name: "bt-ref",
        inputSchema: z.number(),
        outputSchema: schema
      }).step(sharedBlock);
      expect(() => seq.validate()).not.toThrow();
    });

    it(".validate() throws on a top-level type-name mismatch", () => {
      const seq = sequencer({
        name: "bt-kind",
        inputSchema: z.number(),
        outputSchema: z.number()
      }).step(strBlock);

      let caught: any;
      try {
        seq.validate();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SequencerSchemaMismatchError);
      expect(caught.details.declaredKind).toBe("ZodNumber");
      expect(caught.details.inferredKind).toBe("ZodString");
    });

    it(".validate() throws on an object key-set mismatch", () => {
      const objBlock = handler({
        name: "obj-ab",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: () => ({ a: 1, b: 2 })
      });
      const seq = sequencer({
        name: "bt-keys",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.number() })
      }).step(objBlock);

      let caught: any;
      try {
        seq.validate();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SequencerSchemaMismatchError);
      expect(caught.details.reason).toContain("key sets differ");
    });

    it(".validate() throws on a one-level object value-kind mismatch", () => {
      const objBlock = handler({
        name: "obj-a-num",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.number() }),
        execute: () => ({ a: 1 })
      });
      const seq = sequencer({
        name: "bt-valkind",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.string() })
      }).step(objBlock);

      let caught: any;
      try {
        seq.validate();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SequencerSchemaMismatchError);
      expect(caught.details.reason).toContain('"a"');
      // The reported kinds reflect the level of the mismatch, not the top-level object kind.
      expect(caught.details.declaredKind).toBe("ZodString");
      expect(caught.details.inferredKind).toBe("ZodNumber");
    });

    it(".validate() throws on an array element kind mismatch", () => {
      const arrBlock = handler({
        name: "arr-num",
        inputSchema: z.number(),
        outputSchema: z.array(z.number()),
        execute: () => [1]
      });
      const seq = sequencer({
        name: "bt-arr",
        inputSchema: z.number(),
        outputSchema: z.array(z.string())
      }).step(arrBlock);

      let caught: any;
      try {
        seq.validate();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SequencerSchemaMismatchError);
      expect(caught.details.reason).toContain("array element");
    });

    it(".validate() no-ops when a schema-erasing op leaves no tracked schema", () => {
      const seq = sequencer({
        name: "bt-erased",
        inputSchema: z.number(),
        outputSchema: z.string()
      }).stepAny([strBlock]);
      // stepAny erases lastOutputSchema → nothing to compare against.
      expect(() => seq.validate()).not.toThrow();
    });

    it(".validate() no-ops when no outputSchema is declared", () => {
      const seq = sequencer({ name: "bt-noschema", inputSchema: z.number() }).step(strBlock);
      expect(() => seq.validate()).not.toThrow();
    });
  });
});

describe("block-level rescue (FIX-742)", () => {
  class RateLimitError extends Error {}
  class OtherError extends Error {}

  function throwing(name: string, err: () => Error = () => new Error("boom")) {
    return handler({
      name,
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => {
        throw err();
      }
    });
  }

  it("recovers a leaf block to the handler's output instead of throwing", async () => {
    const failing = throwing("leaf-fail");
    const fallback = handler({
      name: "leaf-fallback",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: (error: Error) => `recovered:${error.message}`
    });

    const ctx = createMockContext();
    await expect(runForTest(failing.rescue([{ block: fallback }]), 1, ctx)).resolves.toBe(
      "recovered:boom"
    );
  });

  it("lets the chain continue after a rescued step", async () => {
    const failing = throwing("mid-step", () => new Error("mid"));
    const fallback = handler({
      name: "mid-fallback",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => 0
    });
    const after = addHandler("after-rescue", 5);

    const seq = sequencer({ name: "continue-seq", inputSchema: z.number() })
      .step(addHandler("before-rescue", 1))
      .step(failing.rescue([{ block: fallback }]))
      .step(after);

    const ctx = createMockContext();
    // before (1 -> 2), failing rescued to 0, after (0 -> 5).
    await expect(runForTest(seq, 1, ctx)).resolves.toBe(5);
  });

  it("leaves the running value unchanged when a tapped block is rescued", async () => {
    let sideEffect = "";
    const failing = throwing("tap-fail");
    const fallback = handler({
      name: "tap-fallback",
      inputSchema: z.any(),
      outputSchema: z.null(),
      execute: () => {
        sideEffect = "ran";
        return null;
      }
    });

    const seq = sequencer({ name: "tap-rescue-seq", inputSchema: z.number() })
      .tap(failing.rescue([{ block: fallback }]))
      .step(addHandler("after-tap", 10));

    const ctx = createMockContext();
    // tap discards output; the running value (1) flows to after-tap -> 11.
    await expect(runForTest(seq, 1, ctx)).resolves.toBe(11);
    expect(sideEffect).toBe("ran");
  });

  it("isolates a failing forEach element via per-element rescue", async () => {
    const fallback = handler({
      name: "elem-fallback",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => -1
    });
    const double = handler({
      name: "elem-double",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (n: number) => {
        if (n === 2) throw new Error("bad element");
        return n * 10;
      }
    });

    const seq = sequencer({ name: "foreach-rescue", inputSchema: z.array(z.number()) })
      .forEach((_item: number, index: number) =>
        index === 1 ? double.rescue([{ block: fallback }]) : double
      );

    const ctx = createMockContext();
    await expect(runForTest(seq, [1, 2, 3], ctx)).resolves.toEqual([10, -1, 30]);
  });

  it("only rescues errors matched by the `when` filter", async () => {
    const fallback = handler({
      name: "when-fallback",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => 99
    });

    const rateLimited = throwing("rate-limited", () => new RateLimitError("429"));
    const ctx = createMockContext();
    await expect(
      runForTest(rateLimited.rescue([{ when: [RateLimitError], block: fallback }]), 1, ctx)
    ).resolves.toBe(99);

    const other = throwing("other-error", () => new OtherError("nope"));
    await expect(
      runForTest(other.rescue([{ when: [RateLimitError], block: fallback }]), 1, createMockContext())
    ).rejects.toThrow("nope");
  });

  it("does not rescue a SuspensionError (control flow propagates)", async () => {
    const fallback = handler({
      name: "suspend-fallback",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => 0
    });
    const suspending = handler({
      name: "suspending",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => {
        throw new SuspensionError({ suspensionId: "s1", reason: "input_required" });
      }
    });

    const ctx = createMockContext();
    await expect(
      runForTest(suspending.rescue([{ block: fallback }]), 1, ctx)
    ).rejects.toBeInstanceOf(SuspensionError);
  });

  it("stamps _didRescue when a leaf rescue recovers, leaving it unset otherwise", async () => {
    const fallback = handler({
      name: "flag-fallback",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => 0
    });

    const recoveredCtx = createMockContext();
    await runForTest(
      sequencer({ name: "flag-rescue", inputSchema: z.number() }).step(
        throwing("flag-fail").rescue([{ block: fallback }])
      ),
      1,
      recoveredCtx
    );
    expect((recoveredCtx as { _didRescue?: boolean })._didRescue).toBe(true);

    const cleanCtx = createMockContext();
    await runForTest(
      sequencer({ name: "flag-clean", inputSchema: z.number() }).step(addHandler("clean", 1)),
      1,
      cleanCtx
    );
    expect((cleanCtx as { _didRescue?: boolean })._didRescue).toBeUndefined();
  });

  it("folds rescue handler resources into the block's declared resources", () => {
    const auditLog = defineResource({
      name: "auditLog",
      scope: "session",
      stateSchema: z.object({ entries: z.array(z.string()) })
    });
    const fallback = handler({
      name: "resource-fallback",
      inputSchema: z.any(),
      outputSchema: z.null(),
      resources: { auditLog },
      execute: () => null
    });

    const rescued = throwing("needs-resource").rescue([{ block: fallback }]);
    expect(rescued.declaredResources).toBeDefined();
    expect(Object.keys(rescued.declaredResources ?? {})).toContain("auditLog");
  });
});
