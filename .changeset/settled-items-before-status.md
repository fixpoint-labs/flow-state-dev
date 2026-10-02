---
"@flow-state-dev/engine": patch
---

On the SQLite and Postgres stores, a request's items are now stored before its final status is written, so a client that reads the status and then the items always gets the items the request finished with, including the action's output (FIX-1749).
