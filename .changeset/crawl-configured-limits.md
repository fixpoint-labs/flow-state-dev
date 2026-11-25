---
"@flow-state-dev/tools": patch
---

`crawl` now uses its configured `maxPages` and `maxDepth` when a call omits either limit. Explicit per-call limits still take precedence (FIX-2821).
