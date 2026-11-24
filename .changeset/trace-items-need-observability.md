---
"@flow-state-dev/engine": patch
---

Trace and other client-hidden items are served over HTTP only while trace observability is on (outside production, or with `FSDEV_TRACE_OBSERVABILITY=true`): with it off, `?include=trace` on a request's stream and on `/continue` is ignored and the caller gets the client view, and `item_types` on the session snapshot and session stream filters only among client-visible items. The server logs once when it ignores such a request (FIX-2911).
