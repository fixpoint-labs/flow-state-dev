---
"@flow-state-dev/workforce": minor
---

`sendMessage` takes `{ task: id }`, which lands in the session working that task, and `{ session: id }`, which lands in one of the user's own conversations; both are checked before anything is written, and a task filed before this release can't be found by id (FIX-2160).
