---
"@flow-state-dev/engine": patch
---

The collection-state reads, the resource manifest and the session debug routes now answer 404 when a session id changes hands between the route's owner check and its own read, as the other session routes already do, so they never serve another user's session (FIX-2048, FIX-1854).
