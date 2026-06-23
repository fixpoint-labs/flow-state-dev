import type { ZodTypeAny } from "zod";
import type { TestBlockOptions, TestFlowOptions } from "../test-utilities/types";

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

export type Scorer<TOutput = unknown> = {
  name: string;
  threshold?: number;
  score: (args: {
    output: TOutput;
    expected?: Partial<TOutput>;
    input: unknown;
  }) => ScoreResult | Promise<ScoreResult>;
};

export interface ScoreResult {
  score: number;
  passed: boolean;
  reason?: string;
  /** Estimated USD cost the scorer itself incurred (e.g. an LLM-judge call).
   *  Optional; set by scorers that make model calls so callers can budget. */
  costUsd?: number;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export interface EvalCase<TInput = unknown, TExpected = unknown> {
  id?: string;
  input: TInput;
  expected?: TExpected;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EvalBlockConfig<TInput = unknown, TOutput = unknown> {
  dataset: EvalCase<TInput, Partial<TOutput>>[];
  scorers: Scorer<TOutput>[];
  concurrency?: number;
  blockOptions?: Partial<Omit<TestBlockOptions<TInput>, "input">>;
  signal?: AbortSignal;
}

export interface EvalFlowConfig<TInput = unknown> {
  action: string;
  dataset: EvalCase<TInput, unknown>[];
  scorers: Scorer<unknown>[];
  concurrency?: number;
  userId?: string;
  flowOptions?: Partial<
    Omit<TestFlowOptions<TInput>, "flow" | "action" | "input" | "userId">
  >;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface EvalCaseResult {
  caseId: string;
  input: unknown;
  output: unknown;
  expected: unknown;
  error?: { message: string; name: string };
  scores: Record<string, ScoreResult>;
  passed: boolean;
  durationMs: number;
}

export interface ScorerSummary {
  mean: number;
  min: number;
  max: number;
  stddev: number;
  passRate: number;
}

export interface EvalReport {
  passed: boolean;
  results: EvalCaseResult[];
  summary: Record<string, ScorerSummary>;
  timing: { totalMs: number; meanPerCaseMs: number };
}

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

export interface LoadDatasetOptions<T = unknown> {
  schema?: ZodTypeAny;
  transform?: (raw: unknown) => T;
}

export interface CsvMapping<TInput = unknown, TExpected = unknown> {
  input: (row: Record<string, string>) => TInput;
  expected?: (row: Record<string, string>) => TExpected;
  id?: (row: Record<string, string>) => string;
}
