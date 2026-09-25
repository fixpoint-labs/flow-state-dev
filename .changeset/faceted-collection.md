---
"@flow-state-dev/core": patch
---

Add `defineFacetedCollection`: a resource collection whose bodies are classified once on write by an evaluator block you pass, storing the answers as `facets`, with a `search` block over the stored answers (optional `minConfidence`, no model call), a `reindex` block that reports `{ reindexed, failed }`, and the `resources` to register on the flow. A misconfiguration throws when the collection is defined: client body edits, `writable: false`, a `reactTo.contentUpdated` binding, parameterized key patterns, and evaluators with computed questions, an input schema that rejects a string, a `flowConfigSchema` or a lazy single resource (FIX-1583).
