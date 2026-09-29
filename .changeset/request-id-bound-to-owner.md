---
"@flow-state-dev/engine": patch
---

A caller-supplied `requestId` is now bound to the principal that owns it (FIX-1018). An action call that sends a request id another user, tenant or organization already holds runs as the caller's own request, under an id returned in `x-request-id` and the 202 body, and never writes, adopts or re-parents the other principal's record. Every point that writes or adopts a request record refuses a foreign-principal record with the new exported `RequestOwnerMismatchError`; the HTTP action route answers that race with `409 request-id-in-use`. A caller reusing its own id is unaffected.
