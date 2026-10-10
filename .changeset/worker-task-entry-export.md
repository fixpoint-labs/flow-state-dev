---
"@flow-state-dev/workforce": minor
---

`workerTaskEntry` is exported, so a worker flow you write can take the tasks a coordinator files for its workers. A delegate whose flow's `work` entry takes tasks only from another board is now reported by `listDelegates` as taking `nothing`, and a task filed for it is refused instead of waiting forever (FIX-1842).
