# POC · the surface census

Retained design evidence for [the spec](../../SPEC.md): every count in it, re-derived from
source. Not run by any default job.

```bash
node specs/issues/FIX-2460/poc/surface-census/census.mjs          # PASS, prints the counts
node specs/issues/FIX-2460/poc/surface-census/census.mjs --plant  # must FAIL: a planted name is unclassified
```

**Totality:** every root export of `@flow-state-dev/testing` is classified as *stays*,
*benchmark*, *bundle*, *folded* or *marker*, or the run fails. On its first run it failed on
`comparePatterns`, a real omission, which is the check working.

## What it showed · 2026-11-05, on `main` at `d6a38c09`

| | Count |
|---|---|
| Testing root exports | 90: 61 stay, 21 benchmark (7 functions, 14 types, 6 of them core's re-exported), 3 bundle, 4 folded (`testSequencer`, `testRouter` and their result types), 1 marker |
| Core root `Benchmark*` types | 6 |
| Patterns root benchmark names | 8 (six adapters, `defaultBenchmarkRegistry`, `sharedDefaultWorker`) |
| Importers of the benchmark names from the testing root | `packages/cli` (the `fsdev benchmark` command, its test and fixture) and `apps/pattern-benchmark` |
| Importers of the bundle tools | 4, all repo tests (`orchestration`, `harness-manager`, `workforce`, `kitchen-sink`) |
| Importers of `testSequencer` / `testRouter` outside testing | 4 test files (3 in Kitchen Sink, 1 in patterns) |

`--plant` exits 1 naming `plantedUnclassifiedName`.
