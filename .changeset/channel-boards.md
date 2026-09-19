---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": patch
---

A `CHANNEL.md` can declare `boards:`, durable task ledgers the channel holds, with `fileTask` and `readBoard` actions on the channel and a `channelBoard()` helper for the worker that drains them (FIX-1385).
