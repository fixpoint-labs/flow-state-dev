---
"@flow-state-dev/core": patch
---

`RequestHost` gains `sessions.read(id)`, which returns a session's flow and its read-only state when the session belongs to the same user, tenant and organization as the request, and `undefined` otherwise (FIX-2160).
