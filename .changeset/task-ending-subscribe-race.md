---
"@flow-state-dev/workforce": patch
---

A subscription a task's session was still saving when the task failed or was cancelled now ends too, instead of staying on and hearing its thread for a task nobody runs (FIX-2788). Ending a task's subscriptions marks the task's ending first, in a new user-scoped collection (`workforce/subscription-task-endings/*`, part of `subscriptionResources`), and a subscribe for that task that commits afterwards reads the mark, ends with the same reason (`task_errored` or `task_cancelled`), and answers `ended`.

Docs: none; the behaviour matches what the docs already say about a failed or cancelled task's subscriptions.
