---
"@flow-state-dev/patterns": minor
---

**Breaking:** the benchmark adapters move to a new subpath, `@flow-state-dev/patterns/benchmark`: `defaultBenchmarkRegistry`, `sharedDefaultWorker`, `supervisorBenchmarkAdapter`, `planAndExecuteBenchmarkAdapter`, `parallelTasksBenchmarkAdapter`, `roundRobinBenchmarkAdapter`, `debateBenchmarkAdapter` and `routedSpecialistsBenchmarkAdapter` are no longer on the root, with no alias; change the import to `from "@flow-state-dev/patterns/benchmark"`. Its types come from `@flow-state-dev/testing/benchmark`, so patterns lists `@flow-state-dev/testing` as an optional peer dependency: install it when you import `patterns/benchmark` (FIX-2460).

Docs: packages/patterns/README.md (the benchmark section imports from `@flow-state-dev/patterns/benchmark` and names the optional `@flow-state-dev/testing` peer), apps/docs/docs/testing/benchmarks.md (its two `import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns"` blocks become `from "@flow-state-dev/patterns/benchmark"`), apps/docs/guides/choosing-patterns-with-benchmarks.md (the same, in its one import block), apps/docs/docs/api/benchmarks.md (the registry's home is `@flow-state-dev/patterns/benchmark`), apps/docs/docs/api/package-roots.md (add `patterns/benchmark` to the subpaths in patterns' row)
