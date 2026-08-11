---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

Harden the checks around detached task-board work (FIX-982).

A detached dispatch now carries the claimed row's incarnation nonce, and the
workstream verifies it before running anything. Previously the check rested on
the task's creation timestamp, which is a millisecond clock — a task deleted and
recreated under the same id inside the same millisecond passed, and the stale
child ran its old payload against the replacement row. A row or a dispatch that
predates the nonce keeps the previous behaviour rather than being refused.

The same check now also refuses a detached child whose claim expired while it
waited to start. Nothing renews a task's lease between the hand-off and the
child's first breath, so a child that sat in the host's queue longer than the
lease used to begin work on a row the board had already released — running the
worker's side effects, then having the result declined and the task recovered and
run a second time. It stops before the worker instead, and the row is left for
the next drain to pick up.

A board also stops treating a detached row as work running elsewhere once that
row's lease has run out. Routing says where a task's work belongs; only the lease
says whether anyone is still on it, so a claimant that died before its background
work started no longer makes the board report itself as drained.

The safety check on a detached worker's payload now rejects non-enumerable and
accessor properties by name. Both were invisible to the check and neither
survives serialization intact: a non-enumerable property is dropped entirely, and
a getter is read again during serialization and can return something other than
the value that was checked.

A request dispatched in-process is no longer reported as started before it has
been registered. Registration is one store write and it can fail; until now that
failure landed only on the run's own promise, which fire-and-forget callers do
not hold. The visible effect: a task handed to a Workstream whose child never
registered used to leave the task sitting untouched until lease recovery picked
it up minutes later, and a `POST` to an action could ack a request that a later
`GET` on its stream would not find. Both now fail at the point they went wrong.

Handing a task to a Workstream is settled before the dispatch rather than after
it, so the parent can no longer mark a task failed after successfully giving it
away. A refused spawn still fails the task exactly as before; a dispatch that
threw leaves the row for the next drain rather than settling work a child may
already be running.

A flow that declares detached work on a single board now checks which board a
dispatch was addressed to. It previously skipped that check as an optimization,
so a stored dispatch naming a board that had since been removed or renamed was
run by whichever board was left — and if the two shared a ledger, nothing
downstream could tell.
