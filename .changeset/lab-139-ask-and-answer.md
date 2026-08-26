---
---

Conductor (lab, LAB-139): a run that needs a decision can ask for one, and be answered.

A coding run that hits a real ambiguity writes its question to a marker file in
its own checkout. The manager posts it to a durable, user-scoped inbox, parks
its board row and returns — so nothing is held open while a person thinks. An
operator answers the row through the new zero-model `conductor.answer` action,
which patches the question, re-queues the board row and runs the drain itself,
starting the run again holding the answer.

Internal to `labs/conductor`; no published package surface changes.
