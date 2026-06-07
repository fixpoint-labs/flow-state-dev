/**
 * Cross-pattern benchmark contract types.
 *
 * These describe the pattern-agnostic benchmark surface: a task (the prompt +
 * locked rubric every subject is scored against), a subject (a runnable
 * sequencer plus the mapping from the generic task onto its input), and the
 * adapter/registry shape patterns expose so they can be benchmarked uniformly.
 *
 * They live in `@flow-state-dev/core` — not `@flow-state-dev/testing` — because
 * `@flow-state-dev/testing` is only a devDependency of pattern packages, so the
 * contract types must be importable from both the benchmark engine (testing)
 * and the pattern adapters (patterns). The engine itself lives in testing.
 *
 * Type-only module: no runtime values.
 */
import type { SequencerDefinition } from "../blocks";
import type { UsesSlot } from "../capability";

/** Coarse task family used to bucket and rank subjects in the scorecard. */
export type BenchmarkCategory =
  | "reasoning"
  | "multi-step-research"
  | "critique-revision"
  | "tool-use";

/**
 * A single benchmark task. The same prompt is fed to every subject (each
 * subject maps it onto its own input shape), and every subject's output is
 * graded by the LLM judge against the locked `rubric`.
 */
export interface BenchmarkTask {
  /** Stable identifier, surfaced in per-cell results and the report. */
  id: string;
  /** Task family for bucketing/ranking. */
  category: BenchmarkCategory;
  /** Prompt fed to every subject (mapped onto each pattern's input). */
  prompt: string;
  /** Locked, published rubric — atomic criteria the LLM judge scores against. */
  rubric: string[];
  /** Optional reference answer/expected value passed to code scorers. */
  expected?: unknown;
  /** Free-form task metadata (source, difficulty, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * A runnable benchmark subject: a sequencer plus the adapter from the generic
 * task to the sequencer's input. `baseline` subjects are the simple reference
 * (e.g. a single-generator answer) deltas are measured against.
 */
export interface BenchmarkSubject {
  /** Display name, unique within a benchmark run. */
  name: string;
  /** Whether this is a pattern under test or the reference baseline. */
  kind: "pattern" | "baseline";
  /** The composed sequencer the engine executes per task. */
  sequencer: SequencerDefinition<any, any>;
  /** Map the generic task onto this subject's input schema. */
  mapTask: (task: BenchmarkTask) => unknown;
  /**
   * Model this subject's generators run on. The engine forces them to this
   * model, falling back to the run's model when unset. Lets one benchmark mix
   * subjects on different models — e.g. cheap-model patterns against a pure
   * expensive-model baseline ("does a Haiku swarm beat raw Sonnet?").
   */
  model?: string;
}

/** Options a pattern adapter consumes when materializing a benchmark subject. */
export interface BenchmarkAdapterOptions {
  /** Executor model every generator in the materialized pattern uses. */
  model: string;
  /** Capabilities forwarded into the pattern's internal generators. */
  uses?: UsesSlot;
}

/**
 * A pattern's benchmark adapter: names the pattern and builds a subject from
 * shared options so the engine can compare patterns without knowing their
 * internals.
 */
export interface BenchmarkAdapter {
  /** Registry key / display name for the pattern. */
  patternName: string;
  /** Materialize the pattern into a runnable subject. */
  build: (opts: BenchmarkAdapterOptions) => BenchmarkSubject;
}

/** Lookup of pattern name → adapter, resolved by `comparePatterns`. */
export type BenchmarkRegistry = Record<string, BenchmarkAdapter>;
