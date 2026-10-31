---
"@flow-state-dev/engine": patch
---

`GET /:flowKind/requests/:requestId/status` now reports `completedAtMs` for a failed request, whose record holds only `failedAtMs` (FIX-2410).
