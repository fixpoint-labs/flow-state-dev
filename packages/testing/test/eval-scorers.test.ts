import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  exactMatch,
  schemaValid,
  contains,
  jsonPath,
  threshold,
  custom,
  allOf,
  anyOf,
} from "../src/eval/scorers";

describe("scorers", () => {
  describe("exactMatch", () => {
    it("passes on deep equality", () => {
      const scorer = exactMatch();
      const result = scorer.score({
        output: { a: 1, b: "two" },
        expected: { a: 1, b: "two" },
        input: {},
      });
      expect(result).toEqual({ score: 1, passed: true, reason: undefined });
    });

    it("passes when object keys differ in insertion order", () => {
      const scorer = exactMatch();
      const result = scorer.score({
        output: { b: "two", a: 1 },
        expected: { a: 1, b: "two" },
        input: {},
      });
      expect(result).toEqual({ score: 1, passed: true, reason: undefined });
    });

    it("passes when output has optional undefined fields omitted from expected", () => {
      const scorer = exactMatch();
      const result = scorer.score({
        output: { a: 1, optional: undefined },
        expected: { a: 1 },
        input: {},
      });
      expect(result).toEqual({ score: 1, passed: true, reason: undefined });
    });

    it("fails on mismatch", () => {
      const scorer = exactMatch();
      const result = scorer.score({
        output: { a: 1 },
        expected: { a: 2 },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });

    it("compares a specific field", () => {
      const scorer = exactMatch("name");
      const result = scorer.score({
        output: { name: "alice", age: 30 },
        expected: { name: "alice" },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails when field differs", () => {
      const scorer = exactMatch("name");
      const result = scorer.score({
        output: { name: "alice" },
        expected: { name: "bob" },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });

    it("fails when no expected value", () => {
      const scorer = exactMatch();
      const result = scorer.score({ output: { a: 1 }, input: {} });
      expect(result).toMatchObject({ score: 0, passed: false });
    });
  });

  describe("schemaValid", () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it("passes for valid output", () => {
      const scorer = schemaValid(schema);
      const result = scorer.score({
        output: { name: "alice", age: 30 },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails for invalid output with reason", () => {
      const scorer = schemaValid(schema);
      const result = scorer.score({
        output: { name: "alice", age: "not a number" },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
      expect(result.reason).toContain("age");
    });
  });

  describe("contains", () => {
    it("passes when substring found", () => {
      const scorer = contains("hello");
      const result = scorer.score({ output: "say hello world", input: {} });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("is case-insensitive", () => {
      const scorer = contains("HELLO");
      const result = scorer.score({ output: "hello world", input: {} });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("works with object output via JSON.stringify", () => {
      const scorer = contains("alice");
      const result = scorer.score({
        output: { name: "alice" },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails when substring not found", () => {
      const scorer = contains("missing");
      const result = scorer.score({ output: "hello world", input: {} });
      expect(result).toMatchObject({ score: 0, passed: false });
    });
  });

  describe("jsonPath", () => {
    it("extracts and compares nested value", () => {
      const scorer = jsonPath("response.name", "alice");
      const result = scorer.score({
        output: { response: { name: "alice" } },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("handles array indices via numeric segment", () => {
      const scorer = jsonPath("items.0.id", "abc");
      const result = scorer.score({
        output: { items: [{ id: "abc" }] },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails on mismatch", () => {
      const scorer = jsonPath("x.y", 42);
      const result = scorer.score({
        output: { x: { y: 99 } },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });

    it("fails on missing path", () => {
      const scorer = jsonPath("x.y.z", "value");
      const result = scorer.score({
        output: { x: {} },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });
  });

  describe("threshold", () => {
    it("passes when value meets minimum", () => {
      const scorer = threshold("confidence", 0.8);
      const result = scorer.score({
        output: { confidence: 0.95 },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("passes when value is within range", () => {
      const scorer = threshold("score", 0, 1);
      const result = scorer.score({
        output: { score: 0.5 },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails below minimum", () => {
      const scorer = threshold("confidence", 0.8);
      const result = scorer.score({
        output: { confidence: 0.5 },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });

    it("fails above maximum", () => {
      const scorer = threshold("score", 0, 1);
      const result = scorer.score({
        output: { score: 1.5 },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
    });

    it("fails when field is not a number", () => {
      const scorer = threshold("value", 0);
      const result = scorer.score({
        output: { value: "nope" },
        input: {},
      });
      expect(result).toMatchObject({ score: 0, passed: false });
      expect(result.reason).toContain("not a number");
    });
  });

  describe("custom", () => {
    it("wraps a user-provided function", () => {
      const scorer = custom("myScorer", ({ output }) => ({
        score: typeof output === "string" ? 1 : 0,
        passed: typeof output === "string",
      }));
      expect(scorer.name).toBe("myScorer");
      const result = scorer.score({ output: "hello", input: {} });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("supports async scoring", async () => {
      const scorer = custom("asyncScorer", async ({ output }) => {
        return { score: 1, passed: true, reason: `Got ${output}` };
      });
      const result = await scorer.score({ output: "test", input: {} });
      expect(result).toMatchObject({ score: 1, passed: true });
    });
  });

  describe("allOf", () => {
    it("passes when all child scorers pass", async () => {
      const scorer = allOf(exactMatch("a"), exactMatch("b"));
      const result = await scorer.score({
        output: { a: 1, b: 2 },
        expected: { a: 1, b: 2 },
        input: {},
      });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails when any child scorer fails", async () => {
      const scorer = allOf(exactMatch("a"), exactMatch("b"));
      const result = await scorer.score({
        output: { a: 1, b: 99 },
        expected: { a: 1, b: 2 },
        input: {},
      });
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
    });

    it("returns min score", async () => {
      const half = custom("half", () => ({ score: 0.5, passed: true }));
      const full = custom("full", () => ({ score: 1, passed: true }));
      const scorer = allOf(half, full);
      const result = await scorer.score({ output: {}, input: {} });
      expect(result.score).toBe(0.5);
    });
  });

  describe("anyOf", () => {
    it("passes when at least one child passes", async () => {
      const fail = custom("fail", () => ({ score: 0, passed: false, reason: "nope" }));
      const pass = custom("pass", () => ({ score: 1, passed: true }));
      const scorer = anyOf(fail, pass);
      const result = await scorer.score({ output: {}, input: {} });
      expect(result).toMatchObject({ score: 1, passed: true });
    });

    it("fails when all children fail", async () => {
      const fail1 = custom("f1", () => ({ score: 0, passed: false, reason: "a" }));
      const fail2 = custom("f2", () => ({ score: 0.2, passed: false, reason: "b" }));
      const scorer = anyOf(fail1, fail2);
      const result = await scorer.score({ output: {}, input: {} });
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.2);
      expect(result.reason).toContain("All failed");
    });
  });
});
