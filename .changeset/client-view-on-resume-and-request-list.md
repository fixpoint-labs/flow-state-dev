---
"@flow-state-dev/engine": patch
---

A request stream resumed with a cursor no longer sends the content of a client-hidden item whose `item.added` came before the cursor, and `GET /sessions/:id/requests?include_items=true` lists only client-visible items unless trace observability is on (outside production, or with `FSDEV_TRACE_OBSERVABILITY=true`) (FIX-2912).
