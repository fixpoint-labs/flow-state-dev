/**
 * Engine-side benchmark types.
 *
 * These describe the inputs/outputs of the benchmark engine that lives in
 * `@flow-state-dev/testing`: the run config, the per-cell result the engine
 * collects, the aggregated report, and the `defineBenchmark` discovery shape.
 * The pattern-agnostic contract types (`BenchmarkTask`, `BenchmarkSubject`,
 * etc.) live in `@flow-state-dev/core` and are imported here.
 *
 * Type-only module: no runtime values.
 */
import type { Scorer } from "../eval/types";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type {
  BenchmarkSubject,
  BenchmarkTask,
  BenchmarkCategory
} from "@flow-state-dev/core";

/** Configuration for a single `runBenchmark` invocation. */
export interface RunBenchmarkConfig {
  /** Subjects (patterns + optional baseline) to compare. */
  subjects: BenchmarkSubject[];
  /** Tasks every subject is run against. */
  tasks: BenchmarkTask[];
  /** Executor model id (cheap-paid default applied by callers). */
  model: string;
  /** Distinct judge model id. Defaults to `model` with a self-preference warning. */
  judgeModel?: string;
  /** Extra deterministic code scorers applied uniformly (in addition to the rubric judge). */
  scorers?: Scorer<unknown>[];
  /** k repetitions per (subject, task). Default 3. */
  runs?: number;
  /** Concurrent (subject,task,run) cells. Default 3. */
  concurrency?: number;
  /** Abort + partial report when accumulated cost exceeds this. */
  maxCostUsd?: number;
  /** Executor resolver override (tests inject a mock). Built from `model` when absent. */
  modelResolver?: ModelResolver;
  /** Judge resolver override (tests inject a mock). Built from `judgeModel` when absent. */
  judgeResolver?: ModelResolver;
  /** Cancels in-flight scheduling; produces a partial report. */
  signal?: AbortSignal;
}

/** Aggregated stats for one subject within one category (or "overall"). */
export interface SubjectCategoryStat {
  /** Subject name. */
  subject: string;
  /** Category bucket, or "overall" across all categories. */
  category: BenchmarkCategory | "overall";
  /** Mean judge score (0-1) across successful cells. */
  mean: number;
  /** Population standard deviation of judge scores. */
  stddev: number;
  /** Fraction of cells that passed the judge threshold. */
  passRate: number;
  /** Total cells scheduled for this (subject, category). */
  runs: number;
  /** Cells that completed without error. */
  successfulRuns: number;
  /** Summed estimated USD cost across cells. */
  costUsd: number;
  /** Mean wall-clock latency (ms) per cell. */
  meanLatencyMs: number;
}

/** A subject's standing within a category ranking. */
export interface BenchmarkRanking {
  /** Subject name. */
  subject: string;
  /** Mean judge score (0-1). */
  mean: number;
  /** Mean minus the baseline subject's mean (0 when no baseline). */
  deltaVsBaseline: number;
  /** Whether the delta exceeds the combined subject+baseline stddev. */
  credible: boolean;
}

/** The aggregated, publishable benchmark report. */
export interface BenchmarkReport {
  /** Executor model id used. */
  model: string;
  /** Judge model id, when distinct/known. */
  judgeModel?: string;
  /** Repetitions per (subject, task). */
  runs: number;
  /** Subject names included. */
  subjects: string[];
  /** Categories present across the tasks. */
  categories: BenchmarkCategory[];
  /** Per (subject × category) and (subject × "overall") aggregates. */
  stats: SubjectCategoryStat[];
  /** category (or "overall") -> subjects ranked by mean desc. */
  rankings: Record<string, BenchmarkRanking[]>;
  /** Total estimated USD spend across all cells. */
  totalCostUsd: number;
  /** True when `maxCostUsd` was exceeded and the sweep stopped early. */
  budgetExceeded: boolean;
  /** Non-fatal warnings (e.g. judge == executor self-preference). */
  warnings: string[];
  /** Run timing. */
  timing: { totalMs: number };
}

/** Per-cell record the engine collects before aggregation. */
export interface BenchmarkRunResult {
  /** Subject name. */
  subject: string;
  /** Subject kind (pattern vs baseline). */
  kind: "pattern" | "baseline";
  /** Task id. */
  taskId: string;
  /** Task category. */
  category: BenchmarkCategory;
  /** Repetition index (0-based). */
  run: number;
  /** Judge score 0-1 (0 on failure). */
  score: number;
  /** Whether the judge score met its threshold. */
  passed: boolean;
  /** True when the subject's sequencer errored/threw. */
  errored: boolean;
  /** Estimated USD cost for this cell (best-effort; 0 when unknown). */
  costUsd: number;
  /** Wall-clock latency (ms) for the subject run. */
  latencyMs: number;
  /** Optional deterministic code scorer scores for this cell. */
  codeScores?: Record<string, number>;
}

/** Declarative benchmark definition for CLI/registry discovery. */
export interface BenchmarkDefinition {
  /** Benchmark name. */
  name: string;
  /** Explicit subjects, when not resolving via a registry. */
  subjects?: BenchmarkSubject[];
  /** Pattern names resolved against a registry passed to comparePatterns. */
  patterns?: string[];
  /** Append a baseline subject (default true at run time). */
  baseline?: boolean;
  /** Tasks to run. Must be non-empty. */
  tasks: BenchmarkTask[];
  /** Executor model id. */
  model: string;
  /** Distinct judge model id. */
  judgeModel?: string;
  /** Extra deterministic code scorers. */
  scorers?: Scorer<unknown>[];
  /** Repetitions per (subject, task). */
  runs?: number;
}
