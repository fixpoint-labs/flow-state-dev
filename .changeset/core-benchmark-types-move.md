---
"@flow-state-dev/core": minor
---

**Breaking:** the benchmark contract types `BenchmarkTask`, `BenchmarkCategory`, `BenchmarkSubject`, `BenchmarkAdapter`, `BenchmarkAdapterOptions` and `BenchmarkRegistry` leave the `@flow-state-dev/core` root for `@flow-state-dev/testing/benchmark`, with no alias; change the import to `from "@flow-state-dev/testing/benchmark"` (FIX-2460).

Docs: packages/core/README.md (drop the benchmark types from the root's list, if named), apps/docs/docs/api/benchmarks.md (import the contract types from `@flow-state-dev/testing/benchmark`)
