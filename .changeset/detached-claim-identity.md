---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/core": patch
---

Harden the checks around detached task-board work (FIX-982).

A detached dispatch now carries the claimed row's incarnation nonce, and the
workstream verifies it before running anything. Previously the check rested on
the task's creation timestamp, which is a millisecond clock — a task deleted and
recreated under the same id inside the same millisecond passed, and the stale
child ran its old payload against the replacement row. A row or a dispatch that
predates the nonce keeps the previous behaviour rather than being refused.

A board also stops treating a detached row as work running elsewhere once that
row's lease has run out. Routing says where a task's work belongs; only the lease
says whether anyone is still on it, so a claimant that died before its background
work started no longer makes the board report itself as drained.

The safety check on a detached worker's payload now rejects non-enumerable and
accessor properties by name. Both were invisible to the check and neither
survives serialization intact: a non-enumerable property is dropped entirely, and
a getter is read again during serialization and can return something other than
the value that was checked.
