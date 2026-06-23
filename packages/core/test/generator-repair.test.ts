/**
 * Structured-output repair tests (FIX-841).
 *
 * A generator with a custom `outputSchema` runs in structured-output mode. When
 * a model returns output that fails the schema, the repair pipeline recovers it
 * as a sequence — deterministic parse/jsonrepair/unwrap first, then one LLM
 * coercion call — instead of crashing the block. These tests exercise that
 * sequence with injected models so no real LLM is involved.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generator } from "../src";
import type { GeneratorModel } from "../src/types/model";
import { createMockContext, runForTest } from "./helpers";

const verdictSchema = z.object({
  decision: z.enum(["continue", "replan", "complete"]),
  reasoning: z.string(),
});

/** A GeneratorModel that returns a fixed `text` payload and counts its calls. */
function fixedTextModel(modelId: string, text: string): GeneratorModel & { calls: number } {
  const m = {
    modelId,
    calls: 0,
    async generate() {
      m.calls += 1;
      return { text };
    },
  };
  return m as GeneratorModel & { calls: number };
}

/** A coercion model that fails the test if it is ever called. */
function neverCalledModel(modelId: string): GeneratorModel {
  return {
    modelId,
    async generate() {
      throw new Error("coercion model should not have been called");
    },
  };
}

describe("generator — structured output repair", () => {
  it("coerces off-schema output (renamed keys) via the coercion model", async () => {
    // The reported GLM 5.2 failure: the right decision under the wrong field
    // names. Deterministic repair can't rename keys; coercion must.
    const primary = fixedTextModel(
      "primary",
      JSON.stringify({ action: "replan", reason: "research errored" }),
    );
    const coercion = fixedTextModel(
      "coercion",
      JSON.stringify({ decision: "replan", reasoning: "research errored" }),
    );

    const block = generator({
      name: "evaluator",
      model: primary,
      outputSchema: verdictSchema,
      repair: { coerce: { model: coercion } },
      prompt: "decide",
    });

    const result = (await runForTest(block, { value: "x" }, createMockContext())) as z.infer<
      typeof verdictSchema
    >;
    expect(result).toEqual({ decision: "replan", reasoning: "research errored" });
    expect(coercion.calls).toBe(1);
  });

  it("recovers malformed JSON deterministically, without a coercion call", async () => {
    // Right shape, trailing comma → JSON.parse fails, jsonrepair fixes it in
    // Layer 1. The coercion model would throw if Layer 2 ran.
    const primary = fixedTextModel(
      "primary",
      '{"decision":"complete","reasoning":"done",}',
    );

    const block = generator({
      name: "evaluator",
      model: primary,
      outputSchema: verdictSchema,
      repair: { coerce: { model: neverCalledModel("coercion") } },
      prompt: "decide",
    });

    const result = (await runForTest(block, { value: "x" }, createMockContext())) as z.infer<
      typeof verdictSchema
    >;
    expect(result).toEqual({ decision: "complete", reasoning: "done" });
  });

  it("defaults the coercion model to intent/utility", async () => {
    const primary = fixedTextModel(
      "primary",
      JSON.stringify({ action: "complete", reason: "all done" }),
    );
    const seen: string[] = [];
    const ctx = createMockContext({
      resolveModel: Object.assign(
        (modelId: string): GeneratorModel => {
          seen.push(modelId);
          return {
            modelId,
            async generate() {
              return { text: JSON.stringify({ decision: "complete", reasoning: "all done" }) };
            },
          };
        },
        { resolveId: (modelId: string) => modelId },
      ),
    });

    const block = generator({
      name: "evaluator",
      model: primary, // injected instance → ctx.resolveModel only used for coercion
      outputSchema: verdictSchema,
      prompt: "decide",
    });

    const result = (await runForTest(block, { value: "x" }, ctx)) as z.infer<typeof verdictSchema>;
    expect(result).toEqual({ decision: "complete", reasoning: "all done" });
    expect(seen).toContain("intent/utility");
  });

  it("throws without coercion when repair.coerce is false", async () => {
    const primary = fixedTextModel(
      "primary",
      JSON.stringify({ action: "replan", reason: "x" }),
    );
    const block = generator({
      name: "evaluator",
      model: primary,
      outputSchema: verdictSchema,
      repair: { coerce: false },
      prompt: "decide",
    });
    await expect(runForTest(block, { value: "x" }, createMockContext())).rejects.toThrow();
  });

  it("throws without coercion when repair.mode is 'fail'", async () => {
    const primary = fixedTextModel(
      "primary",
      JSON.stringify({ action: "replan", reason: "x" }),
    );
    const block = generator({
      name: "evaluator",
      model: primary,
      outputSchema: verdictSchema,
      repair: { mode: "fail", coerce: { model: neverCalledModel("coercion") } },
      prompt: "decide",
    });
    await expect(runForTest(block, { value: "x" }, createMockContext())).rejects.toThrow();
  });

  it("does not repair when the model returns valid structured output", async () => {
    const primary: GeneratorModel = {
      modelId: "primary",
      async generate() {
        return { structuredOutput: { decision: "continue", reasoning: "ok" } };
      },
    };
    const block = generator({
      name: "evaluator",
      model: primary,
      outputSchema: verdictSchema,
      repair: { coerce: { model: neverCalledModel("coercion") } },
      prompt: "decide",
    });
    const result = (await runForTest(block, { value: "x" }, createMockContext())) as z.infer<
      typeof verdictSchema
    >;
    expect(result).toEqual({ decision: "continue", reasoning: "ok" });
  });
});
