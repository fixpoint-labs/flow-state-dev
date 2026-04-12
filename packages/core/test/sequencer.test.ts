import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { createMockContext } from "./helpers";

function addHandler(name: string, delta = 1) {
  return handler({
    name,
    inputSchema: z.number(),
    outputSchema: z.number(),
    execute: (value) => value + delta
  });
}

describe("sequencer builder", () => {
  it("supports then and connector overload", async () => {
    const one = addHandler("one", 1);
    const two = addHandler("two", 2);
    const chain = sequencer({ name: "then-chain", inputSchema: z.number() })
      .then(one)
      .then((value) => value * 2, two);

    const ctx = createMockContext();
    await expect(chain.run(1, ctx)).resolves.toBe(6);
  });

  it("supports thenIf", async () => {
    const plusTen = addHandler("plus-ten", 10);
    const seq = sequencer({ name: "then-if", inputSchema: z.number() })
      .thenIf((value) => value > 0, plusTen)
      .thenIf((value) => value > 100, (value) => value, plusTen);

    const ctx = createMockContext();
    await expect(seq.run(1, ctx)).resolves.toBe(11);
  });

  it("supports map", async () => {
    const seq = sequencer({ name: "map-step", inputSchema: z.number() }).map((value) => `v:${value}`);
    const ctx = createMockContext();
    await expect(seq.run(3, ctx)).resolves.toBe("v:3");
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
    await expect(seq.run(2, ctx)).resolves.toEqual({
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
    await expect(direct.run([1, 2], ctx)).resolves.toEqual([3, 4]);
    await expect(viaConnector.run(2, ctx)).resolves.toEqual([4, 5]);
  });

  it("supports doUntil and doWhile", async () => {
    const inc = addHandler("inc", 1);
    const untilSeq = sequencer({ name: "until", inputSchema: z.number() }).doUntil((value) => value >= 3, inc);
    const whileSeq = sequencer({ name: "while", inputSchema: z.number() }).doWhile((value) => value < 3, inc);

    const ctx = createMockContext();
    await expect(untilSeq.run(0, ctx)).resolves.toBe(3);
    await expect(whileSeq.run(0, ctx)).resolves.toBe(3);
  });

  it("supports loopBack", async () => {
    const inc = addHandler("inc", 1);
    const seq = sequencer({ name: "loop-back", inputSchema: z.number() })
      .then(inc)
      .loopBack("inc", {
        when: (value) => (value as number) < 3,
        maxIterations: 5
      });

    const ctx = createMockContext();
    await expect(seq.run(0, ctx)).resolves.toBe(3);
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
    await expect(seq.run(1, ctx)).resolves.toBe(1);
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
    await expect(seq.run(1, ctx)).rejects.toThrow("background failure");
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
      const result = await seq.run([1, 2, 3], ctx);
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
      const result = await seq.run(5, ctx);
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
      const result = await seq.run([1, 2, 3], ctx);
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
      await expect(seq.run([1], ctx)).rejects.toThrow("iteration failure");
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
      await seq.run([1, 2, 3, 4, 5], ctx);
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
      await seq.run([10, 20, 30], ctx);
      expect(executed.sort()).toEqual(["double:10", "double:30", "triple:20"]);
    });
  });

  describe("background alias", () => {
    it("is an alias for work", async () => {
      const workBlock = handler({
        name: "bg-alias-work",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value) => value + 10
      });

      const seq = sequencer({ name: "bg-alias", inputSchema: z.number() })
        .background(workBlock)
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).resolves.toBe(1);
    });

    it("supports connector overload", async () => {
      const workBlock = handler({
        name: "bg-alias-conn",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: async (value) => value.toUpperCase()
      });

      const seq = sequencer({ name: "bg-alias-conn", inputSchema: z.number() })
        .background(
          (value) => String(value),
          workBlock
        )
        .waitForWork({ failOnError: true });

      const ctx = createMockContext();
      await expect(seq.run(42, ctx)).resolves.toBe(42);
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
    await expect(seq.run(2, ctx)).resolves.toBe(2);
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
      .then(failing)
      .rescue([{ block: rescueBlock }]);

    const ctx = createMockContext();
    await expect(seq.run(1, ctx)).resolves.toBe("recovered:broken");
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
    await expect(branching.run(12, ctx)).resolves.toBe("large");
    await expect(none.run(1, ctx)).rejects.toThrow("no matching route");
  });

  describe("inline block definitions", () => {
    it("supports then(handler, config) basic execution", async () => {
      const seq = sequencer({ name: "inline-then", inputSchema: z.number() }).then(handler, {
        outputSchema: z.string(),
        execute: (input: number) => `value:${input}`
      });

      const ctx = createMockContext();
      await expect(seq.run(42, ctx)).resolves.toBe("value:42");
    });

    it("injects inputSchema from previous step's outputSchema", async () => {
      const parseNumber = handler({
        name: "parse",
        inputSchema: z.string(),
        outputSchema: z.number(),
        execute: (value) => Number(value)
      });

      const seq = sequencer({ name: "schema-injection", inputSchema: z.string() })
        .then(parseNumber)
        .then(handler, {
          outputSchema: z.string(),
          execute: (input: number) => `#${input}`
        });

      const ctx = createMockContext();
      await expect(seq.run("7", ctx)).resolves.toBe("#7");
    });

    it("auto-generates name when name omitted", async () => {
      const seq = sequencer({ name: "auto-name", inputSchema: z.number() }).then(handler, {
        outputSchema: z.number(),
        execute: (input: number) => input * 2
      });

      const ctx = createMockContext();
      await expect(seq.run(5, ctx)).resolves.toBe(10);
    });

    it("uses provided name when name is given", async () => {
      const seq = sequencer({ name: "named-inline", inputSchema: z.number() }).then(handler, {
        name: "my-doubler",
        outputSchema: z.number(),
        execute: (input: number) => input * 2
      });

      const ctx = createMockContext();
      await expect(seq.run(5, ctx)).resolves.toBe(10);
    });

    it("supports chained inline blocks", async () => {
      const seq = sequencer({ name: "chained-inline", inputSchema: z.number() })
        .then(handler, {
          outputSchema: z.object({ doubled: z.number() }),
          execute: (input: number) => ({ doubled: input * 2 })
        })
        .then(handler, {
          outputSchema: z.string(),
          execute: (input: { doubled: number }) => `result:${input.doubled}`
        });

      const ctx = createMockContext();
      await expect(seq.run(5, ctx)).resolves.toBe("result:10");
    });

    it("supports tap(handler, config) side effect", async () => {
      const sideEffects: number[] = [];

      const seq = sequencer({ name: "inline-tap", inputSchema: z.number() })
        .then(handler, {
          outputSchema: z.number(),
          execute: (input: number) => input * 3
        })
        .tap(handler, {
          execute: (input: number) => {
            sideEffects.push(input);
          }
        });

      const ctx = createMockContext();
      const result = await seq.run(4, ctx);
      expect(result).toBe(12);
      expect(sideEffects).toEqual([12]);
    });

    it("supports thenIf(condition, handler, config) conditional", async () => {
      const seq = sequencer({ name: "inline-then-if", inputSchema: z.number() })
        .thenIf((value) => value > 10, handler, {
          outputSchema: z.string(),
          execute: (input: number) => `big:${input}`
        });

      const ctx = createMockContext();
      // Condition not met — passthrough
      await expect(seq.run(5, ctx)).resolves.toBe(5);
      // Condition met — inline block runs
      await expect(seq.run(15, ctx)).resolves.toBe("big:15");
    });

    it("supports mixed inline + pre-defined blocks", async () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const seq = sequencer({ name: "mixed-chain", inputSchema: z.number() })
        .then(addOne)
        .then(handler, {
          outputSchema: z.number(),
          execute: (input: number) => input * 10
        })
        .then(addOne);

      const ctx = createMockContext();
      // (5 + 1) * 10 + 1 = 61
      await expect(seq.run(5, ctx)).resolves.toBe(61);
    });

    it("falls back to z.any() when no previous schema is available", async () => {
      // First step in chain — no previous block to inherit from
      const seq = sequencer({ name: "no-prev-schema", inputSchema: z.number() }).then(handler, {
        outputSchema: z.string(),
        execute: (input: number) => `first:${input}`
      });

      const ctx = createMockContext();
      await expect(seq.run(99, ctx)).resolves.toBe("first:99");
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

      const seq = sequencer({ name: "output-prop", inputSchema: z.number() }).then(addOne);

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

      const step1 = sequencer({ name: "chain-prop", inputSchema: z.number() }).then(addOne);
      expect((step1.outputSchema as any)._def?.typeName).toBe("ZodNumber");

      const step2 = step1.then((value: number) => value, toStr);
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
      const seq = sequencer({ name: "input-infer" }).then(parseStr);
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
        .then((value: number) => String(value), parseStr);
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

    it("validate() passes when chain output matches declared outputSchema", () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      // Declared outputSchema matches chain's last output
      const seq = sequencer({ name: "validate-pass", inputSchema: z.number(), outputSchema: z.number() })
        .then(addOne);

      expect(() => seq.validate()).not.toThrow();
    });

    it("validate() throws when chain output diverges from declared outputSchema", () => {
      const toStr = handler({
        name: "to-str",
        inputSchema: z.number(),
        outputSchema: z.string(),
        execute: (value) => String(value)
      });

      // Declared z.number() but chain ends with z.string()
      const seq = sequencer({ name: "validate-fail", inputSchema: z.number(), outputSchema: z.number() })
        .then(toStr);

      expect(() => seq.validate()).toThrow(/output schema mismatch/);
    });

    it("validate() is a no-op when no outputSchema declared on config", () => {
      const addOne = handler({
        name: "add-one",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + 1
      });

      const seq = sequencer({ name: "validate-noop", inputSchema: z.number() }).then(addOne);
      expect(() => seq.validate()).not.toThrow();
    });

    it("validate() detects object shape mismatch", () => {
      const toObj = handler({
        name: "to-obj",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.number(), b: z.string() }),
        execute: (value) => ({ a: value, b: String(value) })
      });

      // Declared shape has different keys than chain output
      const seq = sequencer({
        name: "validate-shape",
        inputSchema: z.number(),
        outputSchema: z.object({ x: z.number(), y: z.string() })
      }).then(toObj);

      expect(() => seq.validate()).toThrow(/shape mismatch/);
    });
  });

  describe("connectInput", () => {
    it("returns a SequencerDefinition with DSL methods", () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "ci-dsl", inputSchema: z.number() })
        .then(addOne);

      const connected = seq.connectInput((s: string) => Number(s));

      // Should have sequencer DSL methods — not a bare BlockDefinition
      expect(typeof connected.then).toBe("function");
      expect(typeof connected.tap).toBe("function");
      expect(typeof connected.map).toBe("function");
      expect(typeof connected.work).toBe("function");
      expect(connected.kind).toBe("sequencer");
    });

    it("mapper runs before sequencer operations", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "ci-mapper", inputSchema: z.number() })
        .then(addOne);

      const connected = seq.connectInput((s: string) => Number(s));
      const ctx = createMockContext();
      // "5" → 5 → 5 + 1 = 6
      await expect(connected.run("5", ctx)).resolves.toBe(6);
    });

    it("preserves declared resources from child blocks", () => {
      const resource = defineResource({
        stateSchema: z.object({ items: z.array(z.string()) })
      });

      const step = handler({
        name: "step-with-resource",
        inputSchema: z.number(),
        outputSchema: z.number(),
        sessionResources: { myResource: resource },
        execute: (v) => v
      });

      const seq = sequencer({ name: "ci-resources", inputSchema: z.number() })
        .then(step);

      const connected = seq.connectInput((s: string) => Number(s));

      expect(connected.declaredResources).toEqual({
        session: { myResource: resource }
      });
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
        .then(addOne)
        .connectInput((s: string) => Number(s))
        .then(double);

      const ctx = createMockContext();
      // "3" → 3 → 3 + 1 = 4 → 4 * 2 = 8
      await expect(connected.run("3", ctx)).resolves.toBe(8);
    });

    it("preserves name from original sequencer config", () => {
      const seq = sequencer({ name: "my-seq", inputSchema: z.number() })
        .then(addHandler("step", 1));

      const connected = seq.connectInput((s: string) => Number(s));
      expect(connected.name).toBe("my-seq");
    });
  });

  describe("thenAll", () => {
    it("runs blocks concurrently and returns ordered array", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);
      const addThree = addHandler("add-three", 3);

      const seq = sequencer({ name: "then-all", inputSchema: z.number() })
        .thenAll([addOne, addTwo, addThree]);

      const ctx = createMockContext();
      await expect(seq.run(10, ctx)).resolves.toEqual([11, 12, 13]);
    });

    it("supports connector steps", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);

      const seq = sequencer({ name: "then-all-conn", inputSchema: z.number() })
        .thenAll([
          addOne,
          { connector: (value: number) => value * 2, block: addTwo },
        ]);

      const ctx = createMockContext();
      // addOne: 5 + 1 = 6; connector: 5 * 2 = 10, addTwo: 10 + 2 = 12
      await expect(seq.run(5, ctx)).resolves.toEqual([6, 12]);
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
        .thenAll([addOne, failing]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).rejects.toThrow("boom");
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
        .thenAll([slowBlock, slowBlock, slowBlock, slowBlock], { maxConcurrency: 2 });

      const ctx = createMockContext();
      await seq.run(1, ctx);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("returns empty array for empty blocks", async () => {
      const seq = sequencer({ name: "then-all-empty", inputSchema: z.number() })
        .thenAll([]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).resolves.toEqual([]);
    });

    it("collects resources from child blocks", () => {
      const resource = defineResource({
        stateSchema: z.object({ items: z.array(z.string()) }),
      });

      const step = handler({
        name: "res-step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        sessionResources: { myResource: resource },
        execute: (v) => v,
      });

      const seq = sequencer({ name: "then-all-res", inputSchema: z.number() })
        .thenAll([step]);

      expect(seq.declaredResources).toEqual({
        session: { myResource: resource },
      });
    });
  });

  describe("thenAny", () => {
    it("returns first successful result (sequential)", async () => {
      const addOne = addHandler("add-one", 1);
      const addTwo = addHandler("add-two", 2);

      const seq = sequencer({ name: "then-any", inputSchema: z.number() })
        .thenAny([addOne, addTwo]);

      const ctx = createMockContext();
      // Sequential: addOne runs first and succeeds → returns its result, addTwo never runs
      await expect(seq.run(5, ctx)).resolves.toBe(6);
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
        .thenAny([failing, success]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).resolves.toBe(43);
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
        .thenAny([first, second]);

      const ctx = createMockContext();
      await seq.run(5, ctx);
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
        .thenAny([fail1, fail2]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).rejects.toThrow("All blocks in thenAny failed");
    });

    it("throws AggregateError with empty blocks array", async () => {
      const seq = sequencer({ name: "then-any-empty", inputSchema: z.number() })
        .thenAny([]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).rejects.toThrow("thenAny called with no blocks");
    });

    it("works with a single block", async () => {
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "then-any-single", inputSchema: z.number() })
        .thenAny([addOne]);

      const ctx = createMockContext();
      await expect(seq.run(5, ctx)).resolves.toBe(6);
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
      await expect(seq.run(5, ctx)).resolves.toBe(6);
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
      await expect(seq.run(1, ctx)).resolves.toBe(101);
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
      await expect(seq.run(1, ctx)).rejects.toThrow("All blocks in race failed");
    });

    it("throws on empty blocks array", async () => {
      const seq = sequencer({ name: "race-empty", inputSchema: z.number() })
        .race([]);

      const ctx = createMockContext();
      await expect(seq.run(1, ctx)).rejects.toThrow("race called with no blocks");
    });

    it("single block completes normally", async () => {
      const addOne = addHandler("add-one", 1);
      const seq = sequencer({ name: "race-single", inputSchema: z.number() })
        .race([addOne]);

      const ctx = createMockContext();
      await expect(seq.run(10, ctx)).resolves.toBe(11);
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
      await seq.run(1, ctx);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("collects resources from all race blocks", () => {
      const resource = defineResource({
        stateSchema: z.object({ count: z.number() }),
      });

      const step = handler({
        name: "res-step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        sessionResources: { myResource: resource },
        execute: (v) => v,
      });

      const seq = sequencer({ name: "race-res", inputSchema: z.number() })
        .race([step]);

      expect(seq.declaredResources).toEqual({
        session: { myResource: resource },
      });
    });
  });

  describe("exitIf", () => {
    it("exits chain when condition is true", async () => {
      const addTen = addHandler("add-ten", 10);
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "exit-true", inputSchema: z.number() })
        .then(addTen)
        .exitIf((value) => value > 5)
        .then(addOne);

      const ctx = createMockContext();
      // 0 + 10 = 10, exitIf(10 > 5) → exits, skips addOne
      await expect(seq.run(0, ctx)).resolves.toBe(10);
    });

    it("continues chain when condition is false", async () => {
      const addTen = addHandler("add-ten", 10);
      const addOne = addHandler("add-one", 1);

      const seq = sequencer({ name: "exit-false", inputSchema: z.number() })
        .then(addTen)
        .exitIf((value) => value > 100)
        .then(addOne);

      const ctx = createMockContext();
      // 0 + 10 = 10, exitIf(10 > 100) → false, continues → 10 + 1 = 11
      await expect(seq.run(0, ctx)).resolves.toBe(11);
    });

    it("supports async conditions", async () => {
      const seq = sequencer({ name: "exit-async", inputSchema: z.number() })
        .exitIf(async (value) => value === 42);

      const ctx = createMockContext();
      await expect(seq.run(42, ctx)).resolves.toBe(42);
      await expect(seq.run(1, ctx)).resolves.toBe(1);
    });

    it("uses context in condition", async () => {
      const seq = sequencer({ name: "exit-ctx", inputSchema: z.number() })
        .exitIf((_value, ctx) => ctx.request.identity.id === "req_1");

      const ctx = createMockContext();
      // condition checks ctx.request.identity.id === "req_1" → true → exits
      await expect(seq.run(5, ctx)).resolves.toBe(5);
    });

    it("works with background work (auto-await still happens)", async () => {
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
        .then(addOne);

      const ctx = createMockContext();
      const result = await seq.run(5, ctx);
      // exitIf condition is true (5 > 0), so addOne is skipped
      expect(result).toBe(5);
      // But background work should have completed (auto-await)
      expect(workRan).toBe(true);
    });

    it("multiple exitIf in chain — first match wins", async () => {
      const addOne = addHandler("add-one", 1);
      const addTen = addHandler("add-ten", 10);

      const seq = sequencer({ name: "exit-multi", inputSchema: z.number() })
        .then(addOne)
        .exitIf((value) => value > 3)
        .then(addTen)
        .exitIf((value) => value > 50)
        .then(addOne);

      const ctx = createMockContext();
      // 5 + 1 = 6, exitIf(6 > 3) → true → exits with 6
      await expect(seq.run(5, ctx)).resolves.toBe(6);
      // 1 + 1 = 2, exitIf(2 > 3) → false → 2 + 10 = 12, exitIf(12 > 50) → false → 12 + 1 = 13
      await expect(seq.run(1, ctx)).resolves.toBe(13);
    });
  });
});
