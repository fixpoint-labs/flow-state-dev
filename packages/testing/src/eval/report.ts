import type { EvalCaseResult, EvalReport, ScorerSummary } from "./types";

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function computeSummary(scores: number[], passed: boolean[]): ScorerSummary {
  const n = scores.length;
  if (n === 0) {
    return { mean: 0, min: 0, max: 0, stddev: 0, passRate: 0 };
  }

  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  const passCount = passed.filter(Boolean).length;
  const passRate = passCount / n;

  return {
    mean: round(mean),
    min: round(min),
    max: round(max),
    stddev: round(stddev),
    passRate: round(passRate),
  };
}

export function buildReport(
  results: EvalCaseResult[],
  startedAt: number,
): EvalReport {
  const scorerNames = new Set<string>();
  for (const r of results) {
    for (const name of Object.keys(r.scores)) {
      scorerNames.add(name);
    }
  }

  const summary: Record<string, ScorerSummary> = {};
  for (const name of scorerNames) {
    const scores: number[] = [];
    const passed: boolean[] = [];
    for (const r of results) {
      const s = r.scores[name];
      if (s) {
        scores.push(s.score);
        passed.push(s.passed);
      }
    }
    summary[name] = computeSummary(scores, passed);
  }

  const totalMs = Date.now() - startedAt;
  const meanPerCaseMs =
    results.length > 0 ? round(totalMs / results.length, 1) : 0;

  return {
    passed: results.length > 0 && results.every((r) => r.passed),
    results,
    summary,
    timing: { totalMs, meanPerCaseMs },
  };
}
