---
"@flow-state-dev/engine": patch
---

On the SQLite and Postgres stores, the durable items a request holds when it settles, including the action's output, are now stored before its final status is written. A client that reads the status and then the items no longer misses them. Items emitted after the final status (by `onFinished` hooks, for example) are not covered (FIX-1749).
