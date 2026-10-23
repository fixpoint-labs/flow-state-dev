---
"@flow-state-dev/store-sqlite": patch
---

A request's item or event write that arrives after the SQLite store has closed is now logged and dropped instead of throwing an uncaught `The database connection is not open`, so a request cancelled at host shutdown can no longer crash the process (FIX-2097).
