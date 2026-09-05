---
"@flow-state-dev/orchestration": patch
---

A task board that dispatches detached work now returns while that work runs
(FIX-982).

Declaring `dispatch: { mode: "detached" }` moved a worker into a Workstream, but
the request that filed the task still waited for it: the board's exit check
counted the handed-off row as work in flight, so the drain parked until the
child session finished. It now treats a row a Workstream is running as work it
is not the one waiting on, and the launching request completes as soon as it has
dispatched everything it can. A board with no detached workers is unaffected — an
in-progress task still holds its drain open.

Two related fixes were needed for detached dispatch to reach a worker at all. The
payload handed to a detached worker now omits absent optional fields rather than
sending them as `undefined`, which the cross-process safety check rejected — a
task that had never failed always carried an absent `feedback`, so every spawn
was refused. And the block a detached dispatch enters now declares the board's
durable collection, so it resolves the ledger holding the row instead of an empty
one and reporting the claim as stale.
