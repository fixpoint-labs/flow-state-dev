---
"@flow-state-dev/engine": patch
---

A session's history now includes a request its host died in (`interrupted`), with only its settled items, so the next turn sees the message that started that turn and the tool calls that already ran instead of starting without them. An interrupted request still parked on a gate that drives it again (pending, or resolved and owed a re-drive), or one a `/retry` re-ran, is left out. Session retention now bounds interrupted requests too (`maxAge`, `maxItems`), and never deletes a parked one. `applyRetentionPolicy` takes an optional durability provider as its last argument to read those gates (FIX-2101).
