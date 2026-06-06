---
sidebar_label: Benchmarks
---

# Benchmarking patterns

Evals answer one question: is this output correct? You hand a block a dataset, score the results, and find out whether the thing you built does its job.

The benchmark harness answers a different question. Not "is the output correct" but "was the coordination shape the right call." A coordination pattern is the wiring around your model calls. A supervisor that reviews each result and retries on rejection. A debate that pits two stances against a judge. A plan-and-execute loop that replans after each step. Same model, same task, different shape. The shape changes the answer, and the benchmark measures by how much.

It runs the same task suite across many patterns and a baseline, on one model, and prints a single scorecard. Same task, same model, many patterns, one table.

## Why benchmark patterns

When you reach for a coordination pattern you're making a bet: the extra orchestration earns its cost. A supervisor makes more model calls than a single generator. It should produce better output, or the calls are wasted.

That bet is testable. Hold the model fixed. Hold the tasks fixed. Vary only the coordination shape. Whatever moves in the score is attributable to the pattern, not to a different prompt or a different model. One independent variable, measured against a control.

The control matters most. Every comparison includes a single-generator baseline: one model call, no coordination, answering the task directly. "Pattern A scores higher than pattern B" is interesting. "Pattern A beats the naive call you'd write without any framework" is the claim worth making, and the baseline is how you make it.

## Defining a benchmark

A benchmark is a task suite plus the patterns to run it against. `defineBenchmark` from `@flow-state-dev/testing` is the discovery shape the CLI loads.

```ts
import { defineBenchmark } from "@flow-state-dev/testing";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";
import type { BenchmarkTask } from "@flow-state-dev/core";

const tasks: BenchmarkTask[] = [
  {
    id: "reason-scheduling",
    category: "reasoning",
    prompt:
      "Three teammates must each take one of three on-call shifts under a set " +
      "of constraints. Assign each a shift and justify why it's the only valid " +
      "assignment.",
    rubric: [
      "Assigns each person exactly one distinct shift",
      "The assignment respects every stated constraint",
      "Explains why the assignment is uniquely forced, not just asserts it",
    ],
  },
  // ...more tasks
];

export default defineBenchmark({
  name: "my-benchmark",
  registry: defaultBenchmarkRegistry,
  patterns: ["supervisor", "plan-and-execute"],
  baseline: true,
  tasks,
  model: "openai/gpt-5.4-mini",
  judgeModel: "anthropic/claude-haiku-4-5",
  runs: 3,
});
```

Each task carries a `category` and a `rubric`. The category buckets tasks so the scorecard can say "this pattern wins on reasoning, that one wins on planning." The four categories are `reasoning`, `multi-step-research`, `critique-revision`, and `tool-use`. The rubric is the list of criteria the judge grades against. It lives on the task on purpose, so the grading is auditable (see [Scoring honestly](#scoring-honestly)).

The `registry` field carries the pattern lookup on the definition itself. The CLI resolves the `patterns` names against it without importing any specific pattern package. `@flow-state-dev/patterns` ships `defaultBenchmarkRegistry` with the comparable patterns already wired (see [Choosing a model](#choosing-a-model) for executor defaults).

## Running across patterns

In code, `comparePatterns` resolves pattern names against a registry, appends the baseline, and runs the sweep:

```ts
import { comparePatterns } from "@flow-state-dev/testing";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";

const report = await comparePatterns(
  defaultBenchmarkRegistry,
  ["supervisor", "parallel-tasks"],
  {
    tasks,
    model: "openai/gpt-5.4-mini",
    judgeModel: "anthropic/claude-haiku-4-5",
    runs: 3,
  },
);

console.log(report.rankings["overall"]);
```

The registry is the first argument. Passing it in keeps `@flow-state-dev/testing` from depending on `@flow-state-dev/patterns`. The baseline is appended automatically; pass `baseline: false` to skip it.

If you already have explicit subjects (a custom pattern not in any registry, say), call `runBenchmark` directly with a `subjects` array. `baselineSubject({ model })` builds the single-generator control to include alongside them.

From the terminal, `fsdev benchmark` loads a `defineBenchmark` file and prints the scorecard. The full walkthrough lives in the guide: [Choosing a pattern with benchmarks](/guides/choosing-patterns-with-benchmarks).

## Reading the scorecard

A run returns a `BenchmarkReport`. The default `table` format renders subjects as rows, categories plus an `overall` column, and each cell as `mean±stddev` of the judge score (0 to 1) across repetitions.

```
subject            reasoning    multi-step-research  critique-revision  tool-use     overall
supervisor         0.812±0.041  0.755±0.063          0.798±0.052        0.770±0.048  0.784±0.055
parallel-tasks     0.740±0.038  0.781±0.044          0.690±0.071        0.802±0.039  0.753±0.061
single-generator   0.690±0.052  0.661±0.058          0.640±0.066        0.701±0.050  0.673±0.060
```

A higher mean is a better-scoring pattern in that category. The stddev is the spread across repetitions: a wide spread means the result is noisy, and a small gap between two patterns may not mean anything.

`report.rankings` makes the comparison explicit. For each category (and `overall`) it lists subjects sorted by mean, with two fields that earn their keep:

- `deltaVsBaseline` — the subject's mean minus the baseline's mean in that bucket. This is the number that says whether the coordination paid off. A positive delta means the pattern beat the naive single call.
- `credible` — `false` when the delta is smaller than the combined subject-plus-baseline stddev. A delta inside the noise is not a win. Treat `credible: false` as "no measurable difference," not as a result.

The report also carries `totalCostUsd`, `budgetExceeded` (true when a cost ceiling stopped the run early), `warnings`, and `timing`. The `markdown` format renders the same table for pasting into a doc or PR; `json` gives you the full report to process.

## Scoring honestly {#scoring-honestly}

Grading is LLM-as-judge: a model reads each output and scores it. That's a conflict of interest when you're grading your own framework's patterns. The methodology is built to make the numbers defensible anyway.

- **Blinded.** The judge sees only the task and the output. It never sees which pattern produced the output, so it can't favor one shape over another.
- **Distinct judge model.** The judge model is separate from the executor model. A model tends to prefer its own family's phrasing; using a different grader removes that thumb on the scale. If you leave `judgeModel` unset it defaults to the executor and the report carries a self-preference warning.
- **Locked, published rubric.** Each task's grading criteria live on the task and ship with the suite. Anyone can read exactly what the output was scored against. The judge grades the output against those criteria, not against a vague sense of quality.
- **Repetition with a credibility flag.** Each (subject, task) cell runs `k` times (`runs`, default 3). A delta smaller than the pooled standard deviation is flagged not-credible rather than reported as a win. Noise doesn't get to look like a result.

The honest caveat: the defaults wire one shared generator into every pattern. That isolates the coordination shape, not each pattern's best-tuned roster of specialist models. The numbers are scoped to the task suite and the model you ran. They inform a pattern choice for work like the tasks in the suite. They don't rank the patterns in general.

## Choosing a model

The executor model is the one variable you hold fixed across every subject, so pick it deliberately. The published suite defaults to a cheap-paid model (`openai/gpt-5.4-mini`) with a distinct judge (`anthropic/claude-haiku-4-5`). Real runs make real model calls and need provider credentials in the environment.

Cost is tracked best-effort across the sweep. Pass `maxCostUsd` (or `--max-cost` on the CLI) to set a ceiling: when the running estimate crosses it, the sweep stops and returns a partial report with `budgetExceeded: true`.

To run on a free-tier model instead, override the executor with an OpenRouter model id. It's opt-in by design, since free-tier models rate-limit and the point of the default is a reproducible paid baseline.

```bash
fsdev benchmark ./benchmark.ts \
  --model openrouter/meta-llama/llama-3.1-70b-instruct
```

## See also

- [Patterns overview](../patterns/overview) — the coordination patterns you'd compare
- [Testing overview](./overview.md) — evals and the rest of the testing package
- [Benchmark API reference](../api/benchmarks.md) — signatures and option tables
- [Choosing a pattern with benchmarks](/guides/choosing-patterns-with-benchmarks) — task-oriented walkthrough
