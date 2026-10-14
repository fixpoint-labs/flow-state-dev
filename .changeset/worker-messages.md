---
"@flow-state-dev/workforce": minor
---

Workers can message each other with a `messageWorker({ to, text, replyTo? })` tool that lands the message in the recipient's own conversation and wakes it, limited by `hireWorkforce`'s `messages: { hopLimit, perTurn }`, and `findWorkerSession` / `ensureWorkerSession` with `{ worker }` now return only the session at the worker's derived address (FIX-1989).
