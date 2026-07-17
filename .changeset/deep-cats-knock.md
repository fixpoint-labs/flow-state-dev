---
"@flow-state-dev/engine": patch
---

Suppress `item.updated` SSE events for items hidden from the client (aligned with `item.added` and content event filtering). Resume cursors seed suppressed item ids from pre-cursor persisted events.
