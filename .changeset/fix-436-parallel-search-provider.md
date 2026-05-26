---
"@flow-state-dev/tools": patch
---

Add Parallel.ai as a search provider in `tools.search`. Set `PARALLEL_API_KEY` to enable it (it takes priority in auto-selection), or import `parallelSearch` directly for explicit use. A new `searchMode` config field passes a provider-specific mode hint (Parallel defaults to `"agentic"`).
