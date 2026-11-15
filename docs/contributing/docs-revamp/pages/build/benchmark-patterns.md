---
title: Benchmark patterns on your own tasks
type: recipe
description: Run the same support-desk tasks through two coordination patterns and a single-call baseline, then read one scorecard to see whether the extra model calls paid off.
---

# Benchmark patterns on your own tasks

A coordination pattern is the wiring around your model calls: a supervisor that reviews each result and retries on rejection, a debate between two stances and a judge. It costs more model calls than one generator, so it should produce better output. The benchmark harness checks that. It runs the same tasks through each pattern you name and through a single-generator baseline (one model call, no coordination), then prints one scorecard.

The model, the tasks and the judge are the same for every subject, where a subject is a pattern or the baseline. The coordination shape is the only thing that varies. The harness asks whether the shape was the right call.

Install `@flow-state-dev/testing` and `@flow-state-dev/patterns`. Real runs make paid model calls and need provider keys in the environment for the task model and the judge model.

## 1. Write a task suite

A task is a prompt plus a `rubric`, the list of criteria a judge model scores the output against. Its `category` is any label you choose. The scorecard gets one column per category. Write each criterion as one claim, because the judge scores them separately and averages.

```ts title="benchmark.ts"
import { defineBenchmark, type BenchmarkTask } from "@flow-state-dev/testing/benchmark";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns/benchmark";

const tasks: BenchmarkTask[] = [
  {
    id: "refund-late-parcel",
    category: "reasoning",
    prompt:
      "A customer's parcel arrived 12 days after the promised date. Our policy " +
      "refunds shipping after 7 days and the full order after 21. Decide what " +
      "to refund and explain it.",
    rubric: [
      "Refunds shipping and not the full order",
      "Cites the 7-day threshold as the reason",
      "States the decision in the first sentence",
    ],
  },
  {
    id: "soften-reply",
    category: "critique-revision",
    prompt: "Rewrite this reply so it is polite without promising a refund: 'No. Read the policy.'",
    rubric: [
      "Keeps the refusal to promise a refund",
      "Uses a polite, direct tone",
      "Points the customer to a next step",
    ],
  },
  // ...more tasks, ideally a dozen or more
];

export default defineBenchmark({
  name: "support-desk",
  registry: defaultBenchmarkRegistry,
  patterns: ["supervisor", "debate"],
  tasks,
  model: "openai/gpt-6-luna",
  judgeModel: "anthropic/claude-haiku-5-5",
  runs: 3,
});
```

`defineBenchmark` declares a benchmark file that `fsdev benchmark` can load. `registry` is where the CLI looks up each name in `patterns`; `defaultBenchmarkRegistry` knows `supervisor`, `plan-and-execute`, `parallel-tasks`, `round-robin`, `debate` and `routed-specialists`. The baseline is added for you. Each (subject, task) pair runs `runs` times, 3 by default. The definition throws if `tasks` is empty.

## 2. Run it

```bash
pnpm fsdev benchmark ./benchmark.ts
```

A run is one subject on one task, once. The example makes 3 subjects x 2 tasks x 3 runs = 18 runs. Each run adds one judge call, and a pattern run makes several model calls of its own. Set a ceiling while you iterate: `--max-cost 2` stops scheduling new runs once the estimate reaches $2, prints a partial scorecard and exits 1. `--runs 1` gives a cheap dry run. `--output scorecard.md --format markdown` writes the result to a file. Details are in the [CLI reference](../reference/cli.md).

## 3. Read the table

The scorecard has two parts. The first has a row per subject and a column per category plus `overall`. Each cell is `mean±stddev` of the judge's score from 0 to 1, pooled over every task and run in that cell. Because a cell pools different tasks, a wide stddev can come from tasks of uneven difficulty, not only from run-to-run noise.

```text
subject            reasoning    critique-revision  overall
supervisor         0.812±0.041  0.798±0.052        0.805±0.047
debate             0.740±0.038  0.690±0.071        0.715±0.061
single-generator   0.690±0.052  0.640±0.066        0.665±0.060
```

The second part ranks subjects by `overall` mean, with `Δ vs baseline`, `credible`, `success`, `$/task` and `score/$`. Read it in this order:

1. `success` first. A subject that throws on a run scores 0 for it, so a low mean can be failures, not quality.
2. `Δ vs baseline` and `credible` on the overall row. A positive delta means the pattern beat the single call. `credible` is `yes` only when the gap is larger than about two standard errors and both sides ran at least twice. `no` means the gap may be noise, not that the pattern lost. More `runs` can turn a `no` into a `yes`.
3. The category columns. A pattern can lose overall and win one category.
4. `$/task` against the delta. A small gain at several times the baseline's cost may not pay.

The judge sees only the task and the output, never which pattern produced it. Set `judgeModel` to a different model than `model`. If it is unset or equal, the CLI prints a warning to stderr, because a judge tends to score its own model's output higher.

The numbers describe your tasks on this model. They do not rank the patterns in general. In the default registry, every pattern that hands the task to an inner generator gets the same one, with the same model and the same prompt. The scorecard compares coordination shapes, not each pattern tuned to its best.

## Next

- [Patterns](../catalog/patterns/index.md): what each pattern in the registry does.
- [Write your own pattern](./write-a-pattern.md): add a pattern the default registry does not have, then benchmark it as a subject.
- [Testing reference](../concepts/testing.md): `comparePatterns`, `runBenchmark`, the report fields and every option.
- [CLI reference](../reference/cli.md): every `fsdev benchmark` flag, including `--model` with an OpenRouter id and `--baseline-model` for cross-model baselines.
