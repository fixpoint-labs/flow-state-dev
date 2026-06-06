---
id: choosing-patterns-with-benchmarks
title: Choosing patterns with benchmarks
description: Pick a coordination pattern by measuring it on your own tasks instead of guessing.
---

# Choosing patterns with benchmarks

The framework ships several coordination patterns: supervisor, debate, plan-and-execute, parallel-tasks, round-robin, routed-specialists. A coordination pattern is a multi-block composition that wires generators together in a particular shape, like reviewing each worker's output or pitting two stances against a judge. Each one earns its keep on some kinds of work and overpays on others.

Rather than argue about which is "best," measure. The benchmark harness runs the same tasks across every pattern plus a single-generator baseline, on one model, and gives you a scorecard. This guide walks through doing that on your own tasks.

If you want the concepts first, read [Benchmarks](/docs/testing/benchmarks). This page is the hands-on version.

## 1. Decide what you care about

Patterns trade cost for quality in different ways. Before you measure, name the dimension you're optimizing. Are these tasks mostly multi-constraint reasoning? Synthesis across several subtopics? Critiquing and revising a flawed draft? Step-by-step planning?

Those map to the four task categories the harness understands: `reasoning`, `multi-step-research`, `critique-revision`, `tool-use`. Tagging each task with a category lets the scorecard tell you "supervisor wins on reasoning, parallel-tasks wins on research" instead of one blurry average.

## 2. Assemble a small task suite

A task is a prompt plus a locked rubric. The rubric is the list of atomic criteria the judge scores each output against. Write it as if you were briefing a careful reviewer.

```ts
// tasks.ts
import type { BenchmarkTask } from "@flow-state-dev/core";

export const tasks: BenchmarkTask[] = [
  {
    id: "reason-budget",
    category: "reasoning",
    prompt:
      "A team has a $10,000 budget. They spend 35% on tooling, then 40% of " +
      "the remainder on contractors, then a flat $1,200 on travel. How much " +
      "is left, and what fraction of the original budget is that? Show each step.",
    rubric: [
      "Computes each intermediate value correctly",
      "Arrives at the correct final remaining amount and its fraction",
      "Shows the arithmetic steps rather than only the final number",
    ],
  },
  {
    id: "research-migration",
    category: "multi-step-research",
    prompt:
      "Produce a migration plan for moving a monolithic REST API to " +
      "event-driven services. Cover data consistency, rollout sequencing, " +
      "and observability as distinct sections with concrete recommendations.",
    rubric: [
      "Includes all three required sections",
      "Each section gives a concrete recommendation rather than generic advice",
      "The sections form a coherent overall plan",
    ],
  },
];
```

Keep rubric criteria atomic. "Correct and well-written" is two criteria; split it. The judge scores each criterion, so vague ones produce vague scores.

You don't have to start from scratch. The shipped suite at `apps/pattern-benchmark` has twelve tasks across all four categories, each with a published rubric, and is a good template to copy from.

## 3. Write the benchmark definition

`defineBenchmark` ties the tasks to the patterns you want to compare. It carries the registry so the CLI can resolve pattern names without importing any pattern package.

```ts
// benchmark.ts
import { defineBenchmark } from "@flow-state-dev/testing";
import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";
import { tasks } from "./tasks";

export default defineBenchmark({
  name: "my-pattern-comparison",
  registry: defaultBenchmarkRegistry,
  patterns: ["supervisor", "parallel-tasks", "debate"],
  baseline: true,
  tasks,
  model: "openai/gpt-5.4-mini",
  judgeModel: "anthropic/claude-haiku-4-5",
  runs: 3,
});
```

`baseline: true` appends the single-generator control. Keep it on. The number you actually want is "did the pattern beat the call I'd write without any of this," and that's the baseline.

## 4. Run it

`fsdev benchmark` loads the definition, resolves the patterns, runs the sweep, and prints the scorecard. Real runs make real model calls, so set a cost ceiling.

```bash
fsdev benchmark ./benchmark.ts --max-cost 0.50 --format markdown
```

Provider credentials come from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`). When the running cost estimate crosses `--max-cost`, the sweep stops and prints a partial scorecard, and the command exits non-zero so a CI step notices.

Useful flags while iterating:

```bash
# only the reasoning tasks, fewer repetitions, while tuning rubrics
fsdev benchmark ./benchmark.ts --category reasoning --runs 1

# a subset of patterns
fsdev benchmark ./benchmark.ts --patterns supervisor,debate

# a free-tier model for a zero-cost dry run
fsdev benchmark ./benchmark.ts --model openrouter/meta-llama/llama-3.1-70b-instruct
```

## 5. Read the scorecard

The default table puts subjects in rows, categories plus `overall` in columns, and `mean±stddev` in each cell:

```
subject           reasoning     multi-step-research  overall
supervisor        0.840±0.060   0.910±0.040          0.875±0.058
parallel-tasks    0.760±0.050   0.880±0.045          0.820±0.072
debate            0.870±0.090   0.800±0.080          0.835±0.091
single-generator  0.720±0.070   0.690±0.090          0.705±0.083
```

Reading it:

- **supervisor leads overall (0.875)** and clearly beats the baseline's 0.705. That delta is large relative to the stddevs, so it's a credible win.
- **debate scores highest on reasoning (0.870)** but its stddev is wide (0.090). It won some runs big and lost others. A high mean with a wide spread is a weaker signal than a slightly lower mean with a tight one.
- **parallel-tasks trails on reasoning (0.760)** but is competitive on research. The category split is doing its job: there's no single winner, there's a winner per kind of work.
- **single-generator is the floor.** Every pattern beats it here, which is the result you hope for. If a pattern doesn't beat the baseline, its extra model calls bought you nothing on these tasks.

The `--format json` output adds `rankings`, where each subject carries a `deltaVsBaseline` and a `credible` flag. `credible` is `false` when the delta is smaller than the combined subject-and-baseline stddev. Treat `credible: false` as "no measurable difference," not as a result. It's the harness refusing to call noise a win.

## Honest caveats

A benchmark like this is evidence, not a verdict.

- **Variance is real.** Three repetitions smooths some of it, not all. A 0.02 gap between two patterns probably means nothing; the `credible` flag is there to stop you over-reading it. Bump `runs` if a result matters and the spread is wide.
- **Your data is not general truth.** These numbers describe how the patterns did on *your* tasks with *your* model. They inform a choice for work that looks like your suite. They don't rank the patterns in the abstract.
- **Defaults share one generator.** Every pattern runs on the same single generator, which isolates the coordination shape but doesn't reflect a pattern tuned with its own roster of specialist models. If you'd deploy a pattern with a hand-picked roster, the real-world gap may be larger than the benchmark shows.

Used with those caveats in mind, the scorecard turns "which pattern should I use" from an argument into a measurement.

## Related

- [Benchmarks](/docs/testing/benchmarks) — the concepts behind this walkthrough.
- [Benchmarks API](/docs/api/benchmarks) — full signatures and option tables.
- [Patterns overview](/docs/patterns/overview) — what each coordination pattern does.
