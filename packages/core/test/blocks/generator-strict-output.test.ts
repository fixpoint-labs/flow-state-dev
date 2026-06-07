// FIX-740: a generator declared with a strict-incompatible output schema
// (reachable z.record / non-literal union) must fail at `generator()`
// construction with a StrictSchemaError naming the offending node, instead of
// failing lazily on the first live model call. See BP-016.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generator } from "../../src";
import { StrictSchemaError } from "../../src/errors/strict-schema-error";

describe("FIX-740: generator output-schema strict guard", () => {
  it("throws at construction when the output schema has a reachable z.record", () => {
    expect(() =>
      generator({
        name: "bad-record-gen",
        model: "openai/gpt-5.4-mini",
        prompt: "hi",
        outputSchema: z.object({ metrics: z.record(z.string(), z.number()) }),
      }),
    ).toThrow(StrictSchemaError);
  });

  it("names the generator and the offending path in the error", () => {
    try {
      generator({
        name: "bad-union-gen",
        model: "openai/gpt-5.4-mini",
        prompt: "hi",
        outputSchema: z.object({
          payload: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
        }),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StrictSchemaError);
      const e = err as StrictSchemaError;
      expect(e.message).toContain('Generator "bad-union-gen"');
      expect(e.violations[0].path).toBe("$.payload");
    }
  });

  it("constructs cleanly for a strict-compatible output schema", () => {
    expect(() =>
      generator({
        name: "good-gen",
        model: "openai/gpt-5.4-mini",
        prompt: "hi",
        outputSchema: z.object({
          summary: z.string(),
          score: z.number().nullable(),
          pairs: z.array(z.object({ key: z.string(), value: z.string() })),
        }),
      }),
    ).not.toThrow();
  });

  it("constructs cleanly when no output schema is declared (text generator)", () => {
    expect(() =>
      generator({
        name: "text-gen",
        model: "openai/gpt-5.4-mini",
        prompt: "hi",
      }),
    ).not.toThrow();
  });
});
