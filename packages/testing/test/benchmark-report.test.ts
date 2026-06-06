import { describe, expect, it } from "vitest";
import {
  buildBenchmarkReport,
  renderScorecard,
} from "../src/benchmark";
import type { BenchmarkRunResult } from "../src/benchmark";

// ---------------------------------------------------------------------------
// buildBenchmarkReport / renderScorecard are pure, so they are
// validated against synthetic per-cell results with no LLM.
// ---------------------------------------------------------------------------

function cell(
  partial: Partial<BenchmarkRunResult> & {
    subject: string;
    kind: "pattern" | "baseline";
    score: number;
  },
): BenchmarkRunResult {
  return {
    taskId: "t1",
    category: "reasoning",
    run: 0,
    passed: partial.score >= 0.5,
    errored: false,
    costUsd: 0,
    latencyMs: 10,
    ...partial,
  };
}

describe("buildBenchmarkReport", () => {
  const meta = {
    model: "openai/gpt-5.4-mini",
    judgeModel: "anthropic/claude-haiku-4-5",
    runs: 2,
    startedAt: Date.now(),
    budgetExceeded: false,
    warnings: [],
  };

  it("aggregates mean/stddev/passRate per subject and overall", () => {
    const runs: BenchmarkRunResult[] = [
      cell({ subject: "supervisor", kind: "pattern", score: 0.8, run: 0 }),
      cell({ subject: "supervisor", kind: "pattern", score: 1.0, run: 1 }),
      cell({ subject: "single-generator", kind: "baseline", score: 0.4, run: 0 }),
      cell({ subject: "single-generator", kind: "baseline", score: 0.6, run: 1 }),
    ];

    const report = buildBenchmarkReport(runs, meta);

    const supOverall = report.stats.find(
      (s) => s.subject === "supervisor" && s.category === "overall",
    );
    expect(supOverall?.mean).toBeCloseTo(0.9, 5);
    expect(supOverall?.passRate).toBe(1);
    expect(supOverall?.successfulRuns).toBe(2);

    const baseOverall = report.stats.find(
      (s) => s.subject === "single-generator" && s.category === "overall",
    );
    expect(baseOverall?.mean).toBeCloseTo(0.5, 5);
  });

  it("ranks subjects by mean and computes baseline delta + credibility", () => {
    const runs: BenchmarkRunResult[] = [
      // supervisor: tight, high → credibly above baseline
      cell({ subject: "supervisor", kind: "pattern", score: 0.9, run: 0 }),
      cell({ subject: "supervisor", kind: "pattern", score: 0.9, run: 1 }),
      // baseline: tight, low
      cell({ subject: "single-generator", kind: "baseline", score: 0.4, run: 0 }),
      cell({ subject: "single-generator", kind: "baseline", score: 0.4, run: 1 }),
    ];

    const report = buildBenchmarkReport(runs, meta);
    const overall = report.rankings["overall"];

    expect(overall[0].subject).toBe("supervisor");
    expect(overall[0].deltaVsBaseline).toBeCloseTo(0.5, 5);
    expect(overall[0].credible).toBe(true); // 0.5 delta >> 0 pooled stddev

    const baselineRank = overall.find((r) => r.subject === "single-generator");
    expect(baselineRank?.deltaVsBaseline).toBe(0);
  });

  it("flags a delta smaller than pooled noise as not credible", () => {
    const runs: BenchmarkRunResult[] = [
      // wide spread → large stddev swamps the small delta
      cell({ subject: "debate", kind: "pattern", score: 0.1, run: 0 }),
      cell({ subject: "debate", kind: "pattern", score: 0.9, run: 1 }),
      cell({ subject: "single-generator", kind: "baseline", score: 0.0, run: 0 }),
      cell({ subject: "single-generator", kind: "baseline", score: 0.8, run: 1 }),
    ];

    const report = buildBenchmarkReport(runs, meta);
    const debate = report.rankings["overall"].find((r) => r.subject === "debate");
    expect(debate?.credible).toBe(false);
  });

  it("aggregates optional code scorer means across successful cells", () => {
    const runs: BenchmarkRunResult[] = [
      cell({ subject: "p", kind: "pattern", score: 0.9, run: 0, codeScores: { exactMatch: 1 } }),
      cell({ subject: "p", kind: "pattern", score: 0.7, run: 1, codeScores: { exactMatch: 0 } }),
    ];
    const report = buildBenchmarkReport(runs, meta);
    const stat = report.stats.find(
      (s) => s.subject === "p" && s.category === "overall",
    );
    expect(stat?.codeScores.exactMatch).toBeCloseTo(0.5, 5);
  });

  it("excludes errored cells from score stats but keeps them in run counts", () => {
    const runs: BenchmarkRunResult[] = [
      cell({ subject: "rlm", kind: "pattern", score: 0.8, run: 0 }),
      cell({ subject: "rlm", kind: "pattern", score: 0, errored: true, passed: false, run: 1 }),
    ];

    const report = buildBenchmarkReport(runs, meta);
    const overall = report.stats.find(
      (s) => s.subject === "rlm" && s.category === "overall",
    );
    expect(overall?.runs).toBe(2);
    expect(overall?.successfulRuns).toBe(1);
    expect(overall?.mean).toBeCloseTo(0.8, 5); // errored cell not averaged in
  });
});

describe("renderScorecard", () => {
  const runs: BenchmarkRunResult[] = [
    cell({ subject: "supervisor", kind: "pattern", score: 0.9, run: 0 }),
    cell({ subject: "single-generator", kind: "baseline", score: 0.4, run: 0 }),
  ];
  const report = buildBenchmarkReport(runs, {
    model: "openai/gpt-5.4-mini",
    runs: 1,
    startedAt: Date.now(),
    budgetExceeded: false,
    warnings: [],
  });

  it("carries the baseline subject identity through aggregation", () => {
    expect(report.baselineSubject).toBe("single-generator");
  });

  it("renders a markdown table marking the baseline", () => {
    const md = renderScorecard(report, "markdown");
    expect(md).toContain("| Subject |");
    expect(md).toContain("supervisor");
    expect(md).toContain("single-generator (baseline)");
  });

  it("renders json that round-trips to the report", () => {
    const json = renderScorecard(report, "json");
    expect(JSON.parse(json).subjects).toEqual(["supervisor", "single-generator"]);
  });

  it("renders plain aligned text", () => {
    const table = renderScorecard(report, "table");
    expect(table).toContain("subject");
    expect(table.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});
