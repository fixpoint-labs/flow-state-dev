---
"@flow-state-dev/workforce": minor
---

A worker session create now refuses a caller-set `filingSessionId`, and every worker flow built on `installation.session()` refuses `delegates`, `fallback`, `taskNotices` and `splitParent` by name instead of dropping them; `ensureWorkerSession` no longer creates a session for a `filingSessionId` (FIX-1855, FIX-1895).
