---
"@flow-state-dev/testing": minor
"@flow-state-dev/cli": patch
---

Add `disableSearch` to benchmarks so a suite can strip provider-native web search across every subject and the judge. When a benchmark's tasks are answerable from model knowledge, live search (`search: true` on a pattern's planner/executor) only adds uncontrolled cost, latency, and run-to-run variance to the comparison — the opposite of what a benchmark wants. Setting `disableSearch: true` on the benchmark definition strips `resolveSearchTool` from the resolved models, so `search: true` silently no-ops everywhere, uniformly, with no change to the patterns under test.

`fsdev benchmark --search` overrides it back on for an ad-hoc search-augmented run. The implementation is a small resolver wrapper (`withoutSearch`); search-augmented behavior, if you want to measure it, belongs in a separate suite whose tasks genuinely need current or external facts.
