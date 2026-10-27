---
"@flow-state-dev/claude-code": patch
"@flow-state-dev/codex": patch
---

A settled item keeps the `itemIndex` it was added with. Closing one could reuse the next item's index, so two items in one request shared an index and replay could not order them.
