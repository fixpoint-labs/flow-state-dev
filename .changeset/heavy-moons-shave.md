---
"@flow-state-dev/orchestration": patch
---

The task substrate now records where a claimed task is running. A claim stamps
`claimedBy` on the task row — the session and request the attempt is running
under, plus the tenant when there is one — and clears it wherever the claim
ends. A task parked for review keeps it, because the request that parked it is
the one that resumes it.

The field is server-side bookkeeping and is never sent to a client: it is
omitted from the `task-change` items the collection publishes. If you adapt a
backing's `onChange` to your own client transport, run `event.task` through the
exported `toEmittedTask` projection so the same omission applies.

Tasks stored before this release have no coordinate, and nothing infers one for
them — the next claim records it.
