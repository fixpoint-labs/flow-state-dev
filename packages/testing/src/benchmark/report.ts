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
  /** Baseline used as the delta reference (the same-model baseline). Falls back
   *  to the first baseline when unset. */
  primaryBaseline?: string;
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
  // Errored cells count as score 0 (reliability is part of pattern quality), so a
  // pattern that frequently fails ranks below a steady one. `successfulRuns` is
  // surfaced separately so a low mean caused by failures is legible.
  const successful = cells.filter((c) => !c.errored);
  const scores = cells.map((c) => (c.errored ? 0 : c.score));
  const { mean, stddev } = meanStddev(scores);
  const passCount = cells.filter((c) => !c.errored && c.passed).length;
  const passRate = cells.length > 0 ? passCount / cells.length : 0;
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

  // The delta reference: the same-model baseline named by the engine, else the
  // first baseline present. Other baselines (e.g. a stronger pure model) are
  // ranked as ordinary rows; their absolute means answer "does the swarm beat
  // that model too?".
  const baselineOrder = [...baselineSubjects];
  const primaryBaseline =
    meta.primaryBaseline !== undefined && baselineSubjects.has(meta.primaryBaseline)
      ? meta.primaryBaseline
      : baselineOrder[0];

  // Rankings: for each category (and "overall"), subjects sorted by mean desc.
  const rankingKeys: Array<BenchmarkCategory | "overall"> = [...categories, "overall"];
  const rankings: Record<string, BenchmarkRanking[]> = {};

  for (const key of rankingKeys) {
    const entries = subjects
      .map((subject) => statBySubjectCategory.get(`${subject}::${key}`))
      .filter((s): s is SubjectCategoryStat => s !== undefined);

    // Baseline mean/stddev/n within this bucket (the primary baseline).
    const baselineStat = entries.find((s) => s.subject === primaryBaseline);
    const baselineMean = baselineStat?.mean ?? 0;
    const baselineStddev = baselineStat?.stddev ?? 0;
    const baselineN = baselineStat?.runs ?? 0;

    const ranked: BenchmarkRanking[] = entries
      .map((s) => {
        const deltaVsBaseline = round(s.mean - baselineMean);
        // Credible when the delta clears ~2 standard errors of the difference of
        // means (stddev/sqrt(n) over all runs). It tightens as repetitions grow,
        // so a delta lost in run-to-run noise is not reported as a win. With
        // fewer than 2 runs in either group the standard error is undefined
        // (a single sample has zero spread), so credibility is withheld rather
        // than trivially asserted.
        const seDiff = Math.sqrt(
          variancePerN(s.stddev, s.runs) + variancePerN(baselineStddev, baselineN),
        );
        const credible =
          s.runs >= 2 &&
          baselineN >= 2 &&
          Math.abs(deltaVsBaseline) > 2 * seDiff;
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
    // Carry baseline identity through aggregation so rendering reads it directly
    // instead of re-deriving it from zero deltas. `primaryBaseline` is the delta
    // reference; `baselineSubjects` lists every baseline (for multi-model runs).
    baselineSubjects: baselineOrder,
    primaryBaseline,
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

function fmtDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}

/**
 * Builds the overall-ranking rows (the headline result): subjects sorted by
 * overall mean with Δ vs the primary baseline, the credibility flag, and a
 * success ratio so failure-driven means are legible. Baselines show "—" for Δ /
 * credible since they are the reference.
 */
function rankingRows(report: BenchmarkReport): string[][] {
  const lookup = statLookup(report);
  const baselines = new Set(report.baselineSubjects);
  // `$/task` is the per-cell cost (subject total / cells), so it's comparable
  // regardless of task or run count; `score/$` = mean / $/task is the quality-per-
  // dollar figure that makes a cheap-orchestrated vs expensive-single comparison
  // legible (a small model that nearly matches a big one at a fraction of the cost
  // wins here even when it loses on mean). Shown "—" when cost wasn't recorded.
  const header = ["rank", "subject", "mean", "Δ vs baseline", "credible", "success", "$/task", "score/$"];
  const rows: string[][] = [header];

  (report.rankings["overall"] ?? []).forEach((r, i) => {
    const overall = lookup.get(`${r.subject}::overall`);
    const success = overall ? `${overall.successfulRuns}/${overall.runs}` : "—";
    const isBaseline = baselines.has(r.subject);
    const costPerTask = overall && overall.runs > 0 ? overall.costUsd / overall.runs : 0;
    const costCell = costPerTask > 0 ? `$${costPerTask.toFixed(4)}` : "—";
    const scorePerDollar = costPerTask > 0 ? (r.mean / costPerTask).toFixed(0) : "—";
    rows.push([
      String(i + 1),
      isBaseline ? `${r.subject} (baseline)` : r.subject,
      r.mean.toFixed(3),
      isBaseline ? "—" : fmtDelta(r.deltaVsBaseline),
      isBaseline ? "—" : r.credible ? "yes" : "no",
      success,
      costCell,
      scorePerDollar,
    ]);
  });

  return rows;
}

/** Render a report as a publishable markdown table. */
function renderMarkdown(report: BenchmarkReport): string {
  const cols = columns(report);
  const lookup = statLookup(report);
  const baselines = new Set(report.baselineSubjects);

  const header = ["Subject", ...cols.map((c) => String(c))];
  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (const subject of report.subjects) {
    const label = baselines.has(subject) ? `${subject} (baseline)` : subject;
    const cells = cols.map((c) => fmtCell(lookup.get(`${subject}::${c}`)));
    lines.push(`| ${[label, ...cells].join(" | ")} |`);
  }

  // Headline ranking — the result people paste into docs.
  const refNote = report.primaryBaseline ? ` (Δ vs ${report.primaryBaseline})` : "";
  lines.push("", `### Overall ranking${refNote}`, "");
  const rows = rankingRows(report);
  lines.push(`| ${rows[0].join(" | ")} |`);
  lines.push(`| ${rows[0].map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) {
    lines.push(`| ${row.join(" | ")} |`);
  }

  return lines.join("\n");
}

function renderAligned(rows: string[][]): string {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => (r[col] ?? "").length)),
  );
  return rows
    .map((r) => r.map((cell, col) => (cell ?? "").padEnd(widths[col])).join("  "))
    .join("\n");
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

  const refNote = report.primaryBaseline ? ` (Δ vs ${report.primaryBaseline})` : "";
  return [
    renderAligned(rows),
    "",
    `overall ranking${refNote}:`,
    renderAligned(rankingRows(report)),
  ].join("\n");
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
