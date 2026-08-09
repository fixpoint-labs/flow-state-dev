---
"@flow-state-dev/engine": patch
---

Scope anonymous interrupted-request recovery to a mixed app's unauthenticated flows, so a caller-supplied `userId` can no longer sweep an authenticated flow's in-flight requests.
