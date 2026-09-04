---
"@flow-state-dev/orchestration": minor
---

Task status `awaiting_review` is now `parked` (FIX-1245).

`parked` is the word the docs and the task board already use for a task waiting on a
person, and it is now the value on the wire too. `TaskStatus`, the transition table, and
every board and skill surface that names the status use it.

Rows persisted under the old name keep working. A stored task still carrying
`awaiting_review` reads back as `parked` on both paths a row can arrive by: through
`taskSchema` where state is parsed, and at the collection read boundary where a task row
is cast rather than parsed — which is the path the task board itself runs on. Nothing to
migrate, and no dual-write window: new writes always store `parked`, and the first write
to a legacy row heals it.

**What to change in your code:** anything comparing a task's status to the string
`awaiting_review`, or listing it in a status filter, should now use `parked`. The
`awaitReview()` method that parks a task is unchanged.

**One thing that is not migrated:** `task-change` items and `task-board-meta` counts
already written into a persisted item log keep the old status word. Replaying an old
trace renders those entries under the old label; live boards are unaffected.
