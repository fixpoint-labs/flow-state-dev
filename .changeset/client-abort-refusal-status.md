---
"@flow-state-dev/client": patch
---

`abortRequest` now rejects with a `ClientHttpError` carrying the route's `status` (for example 409 when the request had already finished, 403 when it isn't yours), instead of a plain `Error`. The message is unchanged, so code that reads it keeps working (FIX-1664).
