---
"@flow-state-dev/engine": patch
---

Aborting a request now stops every run of it still live in the process, and `deregisterAbortController` takes an optional controller so one run ending no longer drops another run's (FIX-1665).
