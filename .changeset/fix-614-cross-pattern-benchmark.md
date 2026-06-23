---
"@flow-state-dev/testing": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/cli": patch
"@flow-state-dev/core": patch
---

Add a cross-pattern benchmark harness that runs a fixed task suite across multiple coordination patterns plus a single-generator baseline on one model and produces a comparative scorecard.

- `@flow-state-dev/testing`: `runBenchmark`, `comparePatterns`, `baselineSubject`, `defineBenchmark`, `buildBenchmarkReport`, and `renderScorecard`. `testBlock` and `analyzerScorer` now accept an optional `modelResolver`, so subjects and the LLM judge can run against real models. Subjects can carry a per-subject `model`, and `comparePatterns` accepts `baselineModels` for cross-model comparisons (cheap-model patterns vs. one or more pure models, e.g. "does a Haiku swarm beat raw Sonnet?").
- `@flow-state-dev/patterns`: benchmark adapters and `defaultBenchmarkRegistry` for the supervisor, plan-and-execute, parallel-tasks, round-robin, debate, and routed-specialists patterns, so adding a pattern adapter gets it benchmarked.
- `@flow-state-dev/cli`: a `fsdev benchmark` command that runs a benchmark definition and prints a table, markdown, or JSON scorecard, with a cost ceiling and a distinct judge model.
- `@flow-state-dev/core`: benchmark contract types (`BenchmarkTask`, `BenchmarkSubject`, `BenchmarkAdapter`, `BenchmarkRegistry`, `BenchmarkCategory`).
