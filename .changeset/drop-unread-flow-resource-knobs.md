---
"@flow-state-dev/core": minor
---

Remove unread `defineFlow({ defaultBlockRenderer })` and `defineResource({ dynamic })`. Neither field was copied onto the runtime instance or read by the engine (FIX-1210).
