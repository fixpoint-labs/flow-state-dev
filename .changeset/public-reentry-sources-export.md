---
"@flow-state-dev/engine": patch
---

`PUBLIC_REENTRY_SOURCES` is now exported: the built-in request sources (`http`, `mcp`, `scheduled`) the public retry, continue and resume routes re-enter. A client that decides whether to offer an answer can pin its own copy to it in a test. A host's `publicReentrySources` option still extends it at runtime (FIX-1662).
