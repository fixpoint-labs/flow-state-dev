---
"@flow-state-dev/engine": patch
---

`RequestHost.resumeWait` now refuses a resume that lands while its turn is still parking as `busy` (retryable) rather than `already-resolved`, so a waited-on task that ends during the park still resumes the waiting turn promptly instead of at the wait's deadline (FIX-2135).
