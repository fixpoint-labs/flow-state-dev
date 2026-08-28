---
"@flow-state-dev/orchestration": minor
---

Task status `awaiting_review` is now `parked` (FIX-1245).

`parked` is the word the docs and the task board already use for a task waiting on a
person, and it is now the value on the wire too. `TaskStatus`, the transition table, and
every board and skill surface that names the status use it.

Rows persisted under the old name keep working: a stored task still carrying
`awaiting_review` reads back as `parked`. Nothing to migrate, and no dual-write window —
the mapping is on the read path only, and new writes always store `parked`.

**What to change in your code:** anything comparing a task's status to the string
`awaiting_review`, or listing it in a status filter, should now use `parked`. The
`awaitReview()` method that parks a task is unchanged.
