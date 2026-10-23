---
"@flow-state-dev/engine": patch
---

A session's history now includes a request its host died in (`interrupted`), with only its settled items, so the next turn sees the ask and the tool calls that already ran instead of starting without them (FIX-2101).
