---
"@flow-state-dev/core": patch
---

Add `defineFacetedCollection`: a resource collection whose bodies are classified once on write by an evaluator block you pass, storing the answers as `facets`, with a `search` block over the stored answers (optional `minConfidence`, no model call), a `reindex` block, and the `resources` to register on the flow. Client body edits, a `reactTo.contentUpdated` binding, parameterized key patterns, and evaluators with computed questions, a `flowConfigSchema` or a lazy single resource are refused when the collection is defined (FIX-1583).
