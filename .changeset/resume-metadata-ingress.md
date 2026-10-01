---
"@flow-state-dev/engine": patch
---

Request metadata can no longer resolve a suspension. `runAction` now drops `metadata.resumeContext` and `metadata.resumeOf` (logging a warning) instead of reading them, so an action request can't pre-approve a human-approval gate or release another request's resume lease. To continue a suspended request, use `continueRequest` (or the resume endpoint), which passes the resolution as the new typed `RunActionOptions.resumeContext`. Code that resumed by calling `runAction` with those metadata keys under a new request id must switch to `continueRequest` (FIX-1707).
