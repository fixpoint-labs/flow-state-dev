---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

A background-work hook that throws no longer fails the dispatch that started the
run (FIX-982).

`runtimeConfig.onBackgroundWork` — the keep-alive hook a serverless adapter wires
to `after()` or `waitUntil` — is called once the run is already under way, and
both of those throw synchronously when called outside a request scope. That throw
escaped `dispatch`, so a request that was running reported as one that had never
started. For a task board handing work to a Workstream that was the damaging
case: the board took the report at face value, reclaimed the row and failed it,
while the child it had been told never started was still running and still trying
to settle the same row. The hook's failure is now logged and the dispatch
reports what actually happened. Registering keep-alive still matters — on a
freeze-after-response platform the run can stall without it — so the failure is
reported at the seam rather than swallowed.

The safety check on a detached worker's payload now also rejects a property
declared non-writable or non-configurable, on objects and array elements alike
(so a frozen array is refused). Serialization rebuilds every property as an
ordinary one, so the value crossed but the guarantee did not: a payload that
could not be modified before it was sent arrived mutable, with nothing on either
side saying the flag had been dropped. Send the value as an ordinary property,
and freeze it again on the far side if the worker needs it read-only.
