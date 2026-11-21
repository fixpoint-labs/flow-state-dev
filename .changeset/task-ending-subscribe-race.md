---
"@flow-state-dev/workforce": patch
---

A subscription a task's session was still saving when the task failed or was cancelled now ends too, instead of staying on and hearing events for a task nobody runs (FIX-2788). Ending a task's subscriptions marks the task's ending first, in a new user-scoped collection (`workforce/subscription-task-endings/*`, part of `subscriptionResources`), and a subscribe for that task that commits afterwards reads the mark, ends with the same reason (`task_errored` or `task_cancelled`), and is refused with an `ended:` reason. A retry of the task is a new attempt, so its own subscribe is not ended by the earlier attempt's mark.

Docs: none; the behaviour matches what the docs already say about a failed or cancelled task's subscriptions.
