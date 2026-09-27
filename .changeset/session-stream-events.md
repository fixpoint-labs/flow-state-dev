---
"@flow-state-dev/contracts": patch
---

Add the session stream's event types: `SessionItemEvent`, `SessionRunsChangedEvent`, `SessionPingEvent`, their union `SessionStreamEvent`, and `SessionRun` (FIX-1609).

Add `compareItemOrder`, the one order items are shown in: `ts`, then `itemIndex`, then `requestId`, then `id`. The session snapshot and a client merging streamed items both sort with it.
