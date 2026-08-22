---
"@flow-state-dev/orchestration": patch
---

New export `resolveCatalogTools(agentKey, toolKeys, catalog, logPrefix)` resolves an agent's `tools:` list against a tool catalog, warning and skipping keys the catalog doesn't hold rather than throwing. (FIX-1211)
