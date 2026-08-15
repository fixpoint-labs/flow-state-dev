---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) now escalates a
dispatch failure by naming what actually failed, instead of reporting a retry
exhaustion that never happened (LAB-112).

Every dispatch failure escalated as `Dispatch <id> exhausted its attempts.`
Conductor deliberately never retries, so that sentence was false for every
failure it was ever written about — it described a mechanism that does not
exist, to the one person being asked to intervene. The real cause reached the
dispatch record and stopped there.

The cost is that the two failures an operator most needs to tell apart arrived
as the same sentence. A credential that never reached the agent process is fixed
in the harness and the work re-run untouched; an agent that genuinely could not
do the work is a task to re-specify. Conductor's ledger is supposed to make every
transition reproducible, and it could not say which of the two had happened.

The settled signal now carries the failure reason, so the escalation reads
`Dispatch <id> failed: <what the dispatcher reported>`. It rides on the signal
rather than being read back off the dispatch record because a ledger row stores
an action's kind and not its text — re-running the reduction from the row is the
only thing that reproduces an escalation's reason, and the reducer has no
collection to fetch one from. Both producers carry it: a failure reduced live,
and one resumed from its record after a restart. A dispatch that failed and named
no cause says so plainly rather than rendering the gap, and a ledger row written
before the field existed still reads.
