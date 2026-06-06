/**
 * Pure aggregation + rendering for benchmark runs.
 *
 * `buildBenchmarkReport` folds the per-cell `BenchmarkRunResult[]` the engine
 * collects into a `BenchmarkReport`: per (subject × category) and per
 * (subject × "overall") stats, plus per-category rankings with baseline deltas
 * and a coarse credibility flag. `renderScorecard` formats a report as plain
 * text, markdown, or JSON. Both are pure (no I/O), so they unit-test against
 * synthetic results without any LLM.
 *
 * Rounding matches the eval report (4 decimals) for consistency.
 */
import type { BenchmarkCategory } from "@flow-state-dev/core";
import type {
  BenchmarkRanking,
  BenchmarkReport,
  BenchmarkRunResult,
  SubjectCategoryStat
} from "./types";

/** Metadata the engine supplies alongside the raw per-cell results. */
export interface BuildBenchmarkReportMeta {
  /** Executor model id. */
  model: string;
  /** Judge model id, when distinct/known. */
  judgeModel?: string;
  /** Repetitions per (subject, task). */
  runs: number;
  /** `Date.now()` at sweep start, for total timing. */
  startedAt: number;
  /** Whether the cost budget tripped. */
  budgetExceeded: boolean;
  /** Accumulated warnings. */
  warnings: string[];
}

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Population mean/stddev over a list of scores (0 for empty). */
function meanStddev(scores: number[]): { mean: number; stddev: number } {
  const n = scores.length;
  if (n === 0) {
    return { mean: 0, stddev: 0 };
  }
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / n;
  return { mean, stddev: Math.sqrt(variance) };
}

/** Variance of a group's mean: stddev^2 / n (0 when n is 0). Used for the
 *  standard error of the difference of means in the credibility test. */
function variancePerN(stddev: number, n: number): number {
  return n > 0 ? (stddev * stddev) / n : 0;
}

/** Aggregate one bucket of cells into a `SubjectCategoryStat`. */
function aggregate(
  subject: string,
  category: BenchmarkCategory | "overall",
  cells: BenchmarkRunResult[]
): SubjectCategoryStat {
  const successful = cells.filter((c) => !c.errored);
  const scores = successful.map((c) => c.score);
  const { mean, stddev } = meanStddev(scores);
  const passCount = successful.filter((c) => c.passed).length;
  const passRate = successful.length > 0 ? passCount / successful.length : 0;
  const costUsd = cells.reduce((acc, c) => acc + c.costUsd, 0);
  const meanLatencyMs =
    cells.length > 0 ? cells.reduce((acc, c) => acc + c.latencyMs, 0) / cells.length : 0;

  // Mean of each optional code scorer across the successful cells that recorded
  // it, so deterministic scorers passed in `RunBenchmarkConfig.scorers` surface
  // in the report alongside the judge score.
  const codeScoreAcc: Record<string, { sum: number; n: number }> = {};
  for (const c of successful) {
    if (c.codeScores === undefined) continue;
    for (const [name, value] of Object.entries(c.codeScores)) {
      const acc = codeScoreAcc[name] ?? { sum: 0, n: 0 };
      acc.sum += value;
      acc.n += 1;
      codeScoreAcc[name] = acc;
    }
  }
  const codeScores: Record<string, number> = {};
  for (const [name, { sum, n }] of Object.entries(codeScoreAcc)) {
    codeScores[name] = round(sum / n);
  }

  return {
    subject,
    category,
    mean: round(mean),
    stddev: round(stddev),
    passRate: round(passRate),
    runs: cells.length,
    successfulRuns: successful.length,
    costUsd: round(costUsd),
    meanLatencyMs: round(meanLatencyMs, 1),
    codeScores
  };
}

/**
 * Folds per-cell results into the aggregated, publishable report: per
 * (subject × category) and (subject × "overall") stats, per-category rankings
 * with baseline deltas, and credibility flags.
 */
export function buildBenchmarkReport(
  runs: BenchmarkRunResult[],
  meta: BuildBenchmarkReportMeta
): BenchmarkReport {
  // Preserve first-seen order for subjects and categories.
  const subjects: string[] = [];
  const categories: BenchmarkCategory[] = [];
  const baselineSubjects = new Set<string>();

  for (const r of runs) {
    if (!subjects.includes(r.subject)) subjects.push(r.subject);
    if (!categories.includes(r.category)) categories.push(r.category);
    if (r.kind === "baseline") baselineSubjects.add(r.subject);
  }

  const stats: SubjectCategoryStat[] = [];
  const statBySubjectCategory = new Map<string, SubjectCategoryStat>();

  for (const subject of subjects) {
    const subjectCells = runs.filter((r) => r.subject === subject);

    for (const category of categories) {
      const cells = subjectCells.filter((r) => r.category === category);
      if (cells.length === 0) continue;
      const stat = aggregate(subject, category, cells);
      stats.push(stat);
      statBySubjectCategory.set(`${subject}::${category}`, stat);
    }

    const overall = aggregate(subject, "overall", subjectCells);
    stats.push(overall);
    statBySubjectCategory.set(`${subject}::overall`, overall);
  }

  // Rankings: for each category (and "overall"), subjects sorted by mean desc.
  const rankingKeys: Array<BenchmarkCategory | "overall"> = [...categories, "overall"];
  const rankings: Record<string, BenchmarkRanking[]> = {};

  for (const key of rankingKeys) {
    const entries = subjects
      .map((subject) => statBySubjectCategory.get(`${subject}::${key}`))
      .filter((s): s is SubjectCategoryStat => s !== undefined);

    // Baseline mean/stddev/n within this bucket (first baseline subject present).
    const baselineStat = entries.find((s) => baselineSubjects.has(s.subject));
    const baselineMean = baselineStat?.mean ?? 0;
    const baselineStddev = baselineStat?.stddev ?? 0;
    const baselineN = baselineStat?.successfulRuns ?? 0;

    const ranked: BenchmarkRanking[] = entries
      .map((s) => {
        const deltaVsBaseline = round(s.mean - baselineMean);
        // Credible when the delta clears ~2 standard errors of the difference of
        // means (pooled stddev/sqrt(n)). Unlike summing raw stddevs, this tightens
        // as repetitions grow, so a real delta gets more credible with more runs
        // and a delta lost in run-to-run noise is not reported as a win.
        const seDiff = Math.sqrt(
          variancePerN(s.stddev, s.successfulRuns) +
            variancePerN(baselineStddev, baselineN),
        );
        const credible = Math.abs(deltaVsBaseline) > 2 * seDiff;
        return { subject: s.subject, mean: s.mean, deltaVsBaseline, credible };
      })
      .sort((a, b) => b.mean - a.mean);

    rankings[key] = ranked;
  }

  const totalCostUsd = round(runs.reduce((acc, r) => acc + r.costUsd, 0));

  return {
    model: meta.model,
    judgeModel: meta.judgeModel,
    runs: meta.runs,
    subjects,
    categories,
    // Carry the baseline's identity through aggregation so rendering reads it
    // directly instead of re-deriving it from zero deltas.
    baselineSubject: baselineSubjects.size > 0 ? [...baselineSubjects][0] : undefined,
    stats,
    rankings,
    totalCostUsd,
    budgetExceeded: meta.budgetExceeded,
    warnings: meta.warnings,
    timing: { totalMs: Date.now() - meta.startedAt }
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtCell(stat: SubjectCategoryStat | undefined): string {
  if (stat === undefined) return "—";
  return `${stat.mean.toFixed(3)}±${stat.stddev.toFixed(3)}`;
}

function statLookup(report: BenchmarkReport): Map<string, SubjectCategoryStat> {
  const map = new Map<string, SubjectCategoryStat>();
  for (const s of report.stats) {
    map.set(`${s.subject}::${s.category}`, s);
  }
  return map;
}

function columns(report: BenchmarkReport): Array<BenchmarkCategory | "overall"> {
  return [...report.categories, "overall"];
}

/** Render a report as a publishable markdown table. */
function renderMarkdown(report: BenchmarkReport): string {
  const cols = columns(report);
  const lookup = statLookup(report);
  const baseline = report.baselineSubject;

  const header = ["Subject", ...cols.map((c) => String(c))];
  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (const subject of report.subjects) {
    const label = subject === baseline ? `${subject} (baseline)` : subject;
    const cells = cols.map((c) => fmtCell(lookup.get(`${subject}::${c}`)));
    lines.push(`| ${[label, ...cells].join(" | ")} |`);
  }

  return lines.join("\n");
}

/** Render a report as plain aligned text. */
function renderTable(report: BenchmarkReport): string {
  const cols = columns(report);
  const lookup = statLookup(report);

  const header = ["subject", ...cols.map((c) => String(c))];
  const rows: string[][] = [header];
  for (const subject of report.subjects) {
    rows.push([subject, ...cols.map((c) => fmtCell(lookup.get(`${subject}::${c}`)))]);
  }

  const widths = header.map((_, col) =>
    Math.max(...rows.map((r) => r[col].length))
  );

  return rows
    .map((r) => r.map((cell, col) => cell.padEnd(widths[col])).join("  "))
    .join("\n");
}

/**
 * Renders a report in the requested format. `markdown` is a publishable table
 * (rows = subjects, columns = categories + overall, cells = mean±stddev,
 * baseline marked). `json` pretty-prints the report. `table` is plain aligned
 * text.
 */
export function renderScorecard(
  report: BenchmarkReport,
  format: "table" | "markdown" | "json"
): string {
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderMarkdown(report);
    case "table":
      return renderTable(report);
  }
}
