# @flow-state-dev/pattern-benchmark

The cross-pattern benchmark suite. It runs a fixed set of tasks across every FSD
coordination pattern plus a single-generator baseline, on one model, and produces
a comparative scorecard. The point is evidence: pattern choice measurably changes
results, and we can show it rather than assert it.

## What it measures

One independent variable: the coordination shape. The task suite and the executor
model are held fixed across all subjects, so a difference in score is a difference
between patterns, not between prompts or models.

Subjects in the default suite:

- `supervisor`, `plan-and-execute`, `parallel-tasks`, `round-robin`, `debate`,
  `routed-specialists`
- `single-generator` — the baseline (one model call, no coordination). Deltas are
  measured against this. "Patterns differ from each other" is interesting;
  "patterns beat the naive call you'd write without the framework" is the point.

Tasks are grouped into four categories (reasoning, multi-step research,
critique/revision, planning) so the scorecard reads "pattern X wins on category Y."

## How it scores honestly

Grading is LLM-as-judge, which is a conflict of interest when you grade your own
framework. The methodology mitigates that:

- **Blinded.** The judge sees only the task and the output, never which pattern
  produced it.
- **Distinct judge model.** The judge model differs from the executor model, so
  it isn't scoring its own family's output.
- **Locked, published rubric.** Each task in `src/tasks.ts` carries the exact
  criteria it's graded against. The rubric ships with the suite so the grading is
  auditable.
- **Repetition + credibility.** Each cell runs `k` times; a delta smaller than the
  pooled standard deviation is flagged not-credible rather than reported as a win.

## Running it

```bash
# default suite (cheap-paid executor + distinct judge), markdown scorecard
fsdev benchmark apps/pattern-benchmark/src/benchmark.ts --format markdown

# override the executor model (e.g. an OpenRouter free-tier model)
fsdev benchmark apps/pattern-benchmark/src/benchmark.ts --model openrouter/meta-llama/llama-3.1-70b-instruct

# cap spend and write JSON for further processing
fsdev benchmark apps/pattern-benchmark/src/benchmark.ts --max-cost 0.50 --output results.json
```

Real runs make real model calls and need provider credentials
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`). Cost is tracked
best-effort and the `--max-cost` ceiling stops the sweep early when exceeded.

## Adding a pattern

Add a benchmark adapter to `@flow-state-dev/patterns`' `defaultBenchmarkRegistry`,
then add its name to the `patterns` list in `src/benchmark.ts`. No per-pattern
harness wiring.

## Caveats

The defaults wire one shared generator into every pattern, so the comparison
isolates the coordination shape rather than each pattern's best-tuned roster.
Numbers are scoped to this task suite and model — they inform a pattern choice,
they don't rank the patterns in general.
