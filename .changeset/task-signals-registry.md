---
---

The UI registry gains `task-signals` (`fsdev ui add task-signals`), a task row's time (FIX-2394). A running row reads `working · 4m 12s`, timed from this attempt's run start. Once its lease has lapsed (orchestration's `leaseLapsed`) it reads `quiet for 7m`, never while your feed is stale. An ended row reads `12m ago`. `taskSignal(view, run, now, { stale })` returns the signal, `TaskTime` draws it with your `tone` per kind, and `taskCounts(views)` gives a heading's `2 running · 1 failed · 28 done`. Pass `taskRowView(row)`, the row's `run.startedAt` and `leaseUntil` from `listTasks`, and your own `now`.

Docs: packages/ui/README.md (a `task-signals` row in the component table)
