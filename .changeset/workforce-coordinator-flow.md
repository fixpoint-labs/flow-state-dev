---
"@flow-state-dev/workforce": minor
---

A coordinator worker hands each post to delegates from its user's own roster: `defineCoordinatorFlow` routes by judgment or best fit, each conversation keeps its own delegates (changed with `addDelegate`, `removeDelegate` and `setFallback`, read with `listDelegates`), and a flow declares `delegatedPostEntry` so its workers can be delegates; the built-in `agent` flow does. `createWorkerInstallation` now refuses a standard worker whose `delegates:` names a worker that isn't standard (FIX-1791).
