---
"@flow-state-dev/engine": patch
---

The collection-state reads, the resource manifest and the session debug routes now answer 404 when a session id changes hands between the route's owner check and its own read, as the other session routes already do, so they never serve another user's session. Session routes that read user- or org-scoped resources (the state snapshot, resource content and state, and the debug routes) now read them under the session they checked, not a second read of the id (FIX-2048, FIX-1854).
