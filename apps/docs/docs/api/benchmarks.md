---
sidebar_position: 7
---

# Benchmarks API

Cross-pattern benchmark harness. The engine and convenience layer live in `@flow-state-dev/testing`; the pattern-agnostic contract types live in `@flow-state-dev/core`. For concepts and worked examples, see [Benchmarking patterns](../testing/benchmarks.md).

## Engine

### `runBenchmark(config)`

Runs a sweep over explicit subjects and returns a `BenchmarkReport`.

```ts
function runBenchmark(config: RunBenchmarkConfig): Promise<BenchmarkReport>;
```

**`RunBenchmarkConfig`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `subjects` | `BenchmarkSubject[]` | — | Subjects (patterns + optional baseline) to compare |
| `tasks` | `BenchmarkTask[]` | — | Tasks every subject is run against |
| `model` | `string` | — | Executor model id used by all subjects |
| `judgeModel` | `string` | `model` | Distinct judge model. Defaults to `model` with a self-preference warning |
| `scorers` | `Scorer<unknown>[]` | — | Extra deterministic code scorers applied alongside the rubric judge |
| `runs` | `number` | `3` | Repetitions per (subject, task) |
| `concurrency` | `number` | `3` | Concurrent (subject, task, run) cells |
| `maxCostUsd` | `number` | — | Abort and return a partial report when accumulated cost exceeds this |
| `modelResolver` | `ModelResolver` | from `model` | Executor resolver override (tests inject a mock) |
| `judgeResolver` | `ModelResolver` | from `judgeModel` | Judge resolver override |
| `signal` | `AbortSignal` | — | Cancels in-flight scheduling; produces a partial report |

## Convenience layer

### `comparePatterns(registry, names, config)`

Resolves `names` against `registry`, appends the single-generator baseline (unless `baseline: false`), and runs. Throws a clear error naming the available patterns when a name is missing.

```ts
function comparePatterns(
  registry: BenchmarkRegistry,
  names: string[],
  config: ComparePatternsConfig,
): Promise<BenchmarkReport>;

type ComparePatternsConfig = Omit<RunBenchmarkConfig, "subjects"> & {
  baseline?: boolean; // default true
};
```

The registry is the first argument so `@flow-state-dev/testing` never imports `@flow-state-dev/patterns`.

### `baselineSubject(options)`

Builds the single-generator control: one generator that answers the task prompt directly, with no coordination. Deltas in the scorecard are measured against this subject.

```ts
function baselineSubject(options: {
  model: string;
  name?: string; // default "single-generator"
}): BenchmarkSubject;
```

### `defineBenchmark(def)`

Validates and returns a benchmark definition (the CLI/registry discovery shape). Identity at runtime; throws if the task suite is empty.

```ts
function defineBenchmark(def: BenchmarkDefinition): BenchmarkDefinition;
```

**`BenchmarkDefinition`:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Benchmark name |
| `subjects` | `BenchmarkSubject[]` | Explicit subjects, when not resolving via a registry |
| `patterns` | `string[]` | Pattern names resolved against `registry` |
| `registry` | `BenchmarkRegistry` | Registry used to resolve `patterns` into subjects |
| `baseline` | `boolean` | Append a baseline subject (default true at run time) |
| `tasks` | `BenchmarkTask[]` | Tasks to run. Must be non-empty |
| `model` | `string` | Executor model id |
| `judgeModel` | `string` | Distinct judge model id |
| `scorers` | `Scorer<unknown>[]` | Extra deterministic code scorers |
| `runs` | `number` | Repetitions per (subject, task) |

## Report

### `BenchmarkReport`

```ts
interface BenchmarkReport {
  model: string;
  judgeModel?: string;
  runs: number;
  subjects: string[];
  categories: BenchmarkCategory[];
  stats: SubjectCategoryStat[];
  rankings: Record<string, BenchmarkRanking[]>;
  totalCostUsd: number;
  budgetExceeded: boolean;
  warnings: string[];
  timing: { totalMs: number };
}
```

`rankings` is keyed by category (and `"overall"`), each value a list of subjects sorted by mean descending:

```ts
interface BenchmarkRanking {
  subject: string;
  mean: number;            // mean judge score (0-1)
  deltaVsBaseline: number; // mean minus the baseline subject's mean (0 when no baseline)
  credible: boolean;       // delta exceeds the combined subject+baseline stddev
}
```

`stats` carries per (subject × category) and per (subject × `"overall"`) aggregates:

```ts
interface SubjectCategoryStat {
  subject: string;
  category: BenchmarkCategory | "overall";
  mean: number;
  stddev: number;          // population standard deviation
  passRate: number;
  runs: number;            // cells scheduled
  successfulRuns: number;  // cells that completed without error
  costUsd: number;
  meanLatencyMs: number;
}
```

### `buildBenchmarkReport(runs, meta)`

Folds per-cell results into a `BenchmarkReport`. Pure (no I/O), so it unit-tests against synthetic results without any LLM.

```ts
function buildBenchmarkReport(
  runs: BenchmarkRunResult[],
  meta: BuildBenchmarkReportMeta,
): BenchmarkReport;
```

### `renderScorecard(report, format)`

Renders a report as plain aligned text, a markdown table, or pretty-printed JSON. The `markdown` format marks the baseline row and is meant for pasting into a doc or PR.

```ts
function renderScorecard(
  report: BenchmarkReport,
  format: "table" | "markdown" | "json",
): string;
```

### `estimateCostUsd`

Best-effort USD cost estimate used internally to enforce `maxCostUsd`.

## Contract types

These live in `@flow-state-dev/core` so both the engine (`@flow-state-dev/testing`) and pattern adapters (`@flow-state-dev/patterns`) can import them.

### `BenchmarkTask`

```ts
interface BenchmarkTask {
  id: string;
  category: BenchmarkCategory;
  prompt: string;
  rubric: string[];        // locked, published criteria the judge scores against
  expected?: unknown;      // optional reference passed to code scorers
  metadata?: Record<string, unknown>;
}

type BenchmarkCategory =
  | "reasoning"
  | "multi-step-research"
  | "critique-revision"
  | "tool-use";
```

### `BenchmarkSubject`

```ts
interface BenchmarkSubject {
  name: string;
  kind: "pattern" | "baseline";
  sequencer: SequencerDefinition<any, any>;
  mapTask: (task: BenchmarkTask) => unknown; // map the generic task onto this subject's input
}
```

### `BenchmarkAdapter` and `BenchmarkRegistry`

A pattern's adapter names the pattern and builds a subject from shared options. A registry is a lookup of pattern name to adapter, resolved by `comparePatterns`.

```ts
interface BenchmarkAdapterOptions {
  model: string;   // executor model every generator in the materialized pattern uses
  uses?: UsesSlot; // capabilities forwarded into the pattern's internal generators
}

interface BenchmarkAdapter {
  patternName: string;
  build: (opts: BenchmarkAdapterOptions) => BenchmarkSubject;
}

type BenchmarkRegistry = Record<string, BenchmarkAdapter>;
```
