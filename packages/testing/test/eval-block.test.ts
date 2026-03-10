import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { evalBlock, exactMatch, custom, contains } from "../src/eval";

describe("evalBlock", () => {
  const echoBlock = handler<{ value: string }, { echoed: string }>({
    name: "echo",
    execute: (input) => ({ echoed: input.value }),
  });

  it("evaluates a dataset and produces a report", async () => {
    const report = await evalBlock(echoBlock, {
      dataset: [
        { id: "t1", input: { value: "hello" }, expected: { echoed: "hello" } },
        { id: "t2", input: { value: "world" }, expected: { echoed: "world" } },
      ],
      scorers: [exactMatch()],
    });

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].caseId).toBe("t1");
    expect(report.results[0].passed).toBe(true);
    expect(report.results[0].scores["exactMatch"]).toMatchObject({
      score: 1,
      passed: true,
    });
    expect(report.summary["exactMatch"].mean).toBe(1);
    expect(report.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("handles failing cases", async () => {
    const report = await evalBlock(echoBlock, {
      dataset: [
        { input: { value: "hello" }, expected: { echoed: "wrong" } },
      ],
      scorers: [exactMatch()],
    });

    expect(report.passed).toBe(false);
    expect(report.results[0].passed).toBe(false);
  });

  it("supports multiple scorers", async () => {
    const report = await evalBlock(echoBlock, {
      dataset: [
        { input: { value: "hello" }, expected: { echoed: "hello" } },
      ],
      scorers: [exactMatch(), contains("hello")],
    });

    expect(report.passed).toBe(true);
    expect(Object.keys(report.results[0].scores)).toHaveLength(2);
  });

  it("auto-generates case IDs", async () => {
    const report = await evalBlock(echoBlock, {
      dataset: [
        { input: { value: "a" }, expected: { echoed: "a" } },
        { input: { value: "b" }, expected: { echoed: "b" } },
      ],
      scorers: [exactMatch()],
    });

    expect(report.results[0].caseId).toBe("case-0");
    expect(report.results[1].caseId).toBe("case-1");
  });

  it("handles block errors gracefully", async () => {
    const failBlock = handler<{ value: string }, { result: string }>({
      name: "fail",
      execute: () => {
        throw new Error("intentional failure");
      },
    });

    const report = await evalBlock(failBlock, {
      dataset: [{ input: { value: "test" } }],
      scorers: [exactMatch()],
    });

    expect(report.passed).toBe(false);
    expect(report.results[0].error).toBeDefined();
    expect(report.results[0].error!.message).toBe("intentional failure");
    expect(report.results[0].scores).toEqual({});
  });

  it("respects concurrency setting", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const slowBlock = handler<{ value: string }, { done: boolean }>({
      name: "slow",
      execute: async () => {
        current++;
        if (current > maxConcurrent) maxConcurrent = current;
        await new Promise((r) => setTimeout(r, 10));
        current--;
        return { done: true };
      },
    });

    const report = await evalBlock(slowBlock, {
      dataset: Array.from({ length: 6 }, (_, i) => ({
        input: { value: String(i) },
        expected: { done: true },
      })),
      scorers: [exactMatch()],
      concurrency: 2,
    });

    expect(report.passed).toBe(true);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("produces JSON-serializable report", async () => {
    const report = await evalBlock(echoBlock, {
      dataset: [
        { input: { value: "test" }, expected: { echoed: "test" } },
      ],
      scorers: [exactMatch()],
    });

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.passed).toBe(true);
    expect(parsed.results[0].scores.exactMatch.score).toBe(1);
  });
});
