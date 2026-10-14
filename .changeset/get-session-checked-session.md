---
"@flow-state-dev/engine": patch
---

`GET /sessions/:id` now answers 404 instead of another owner's session when the session id changed hands after the route's owner check, matching the other session-addressed routes (FIX-1852).
