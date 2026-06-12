---
"@flow-state-dev/server": patch
---

A bare action-root block submitted as an action now honors its own `.rescue()`: when it throws, the matching handler runs and the action returns the recovered output instead of failing, after retries are exhausted (retries run first, then rescue). Non-retryable errors rescue immediately rather than escaping un-rescued.
