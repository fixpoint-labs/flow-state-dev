---
"@flow-state-dev/workforce": minor
---

A worker plans its own work: a task its own turn files naming itself is a step, kept on the session's `plan` ledger and worked by the same request after the turn, one at a time, each a turn of the worker; then the worker answers once more, told how every step ended, and that answer is the request's result. On the built-in `agent` and `coordinator` flows a worker's turn gets the task tools for its steps whatever its delegates; an app's own worker flow wraps its turn in `defineSessionBoard(...).planned(turn)`. A step is filed only by the worker's own turn (an action naming the worker is refused), isn't waited on, completed, failed or blocked by a call, and doesn't trade places with a delegate's task through `assignTask`. Steps count toward the chain's 100 tasks under a top task and add no depth. The conversation board is a `mode: "delegation"` board (FIX-2076).

Migration, at upgrade: a worker's task for itself used to open a task session of its own and park the filing task on it, which then completed with `{ answer, pieces }`. It is now a step in the same request, and the request answers once, as a string.
