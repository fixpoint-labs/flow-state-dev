import { describe, expect, it } from "vitest";
import { buildReport } from "../src/eval/report";
import type { EvalCaseResult } from "../src/eval/types";

function makeCase(
  caseId: string,
  scores: Record<string, { score: number; passed: boolean }>,
  durationMs = 10,
): EvalCaseResult {
  return {
    caseId,
    input: {},
    output: {},
    expected: {},
    scores,
    passed: Object.values(scores).every((s) => s.passed),
    durationMs,
  };
}

describe("buildReport", () => {
  it("computes summary statistics for a single scorer", () => {
    const startedAt = Date.now() - 100;
    const results = [
      makeCase("c1", { acc: { score: 1, passed: true } }),
      makeCase("c2", { acc: { score: 0.8, passed: true } }),
      makeCase("c3", { acc: { score: 0, passed: false } }),
    ];

    const report = buildReport(results, startedAt);

    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(3);
    expect(report.summary.acc).toBeDefined();
    expect(report.summary.acc.mean).toBeCloseTo(0.6, 1);
    expect(report.summary.acc.min).toBe(0);
    expect(report.summary.acc.max).toBe(1);
    expect(report.summary.acc.passRate).toBeCloseTo(2 / 3, 2);
    expect(report.summary.acc.stddev).toBeGreaterThan(0);
  });

  it("reports passed when all cases pass", () => {
    const results = [
      makeCase("c1", { s: { score: 1, passed: true } }),
      makeCase("c2", { s: { score: 0.9, passed: true } }),
    ];
    const report = buildReport(results, Date.now() - 50);
    expect(report.passed).toBe(true);
  });

  it("handles multiple scorers", () => {
    const results = [
      makeCase("c1", {
        exact: { score: 1, passed: true },
        schema: { score: 0, passed: false },
      }),
    ];
    const report = buildReport(results, Date.now() - 10);
    expect(Object.keys(report.summary)).toEqual(
      expect.arrayContaining(["exact", "schema"]),
    );
  });

  it("handles empty results", () => {
    const report = buildReport([], Date.now());
    expect(report.passed).toBe(false);
    expect(report.results).toHaveLength(0);
    expect(report.summary).toEqual({});
  });

  it("includes timing metadata", () => {
    const startedAt = Date.now() - 200;
    const results = [
      makeCase("c1", { s: { score: 1, passed: true } }, 100),
      makeCase("c2", { s: { score: 1, passed: true } }, 100),
    ];
    const report = buildReport(results, startedAt);
    expect(report.timing.totalMs).toBeGreaterThanOrEqual(200);
    expect(report.timing.meanPerCaseMs).toBeGreaterThan(0);
  });

  it("is JSON-serializable", () => {
    const results = [
      makeCase("c1", { s: { score: 0.75, passed: true } }),
    ];
    const report = buildReport(results, Date.now() - 10);
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.passed).toBe(true);
    expect(parsed.summary.s.mean).toBe(0.75);
  });
});
