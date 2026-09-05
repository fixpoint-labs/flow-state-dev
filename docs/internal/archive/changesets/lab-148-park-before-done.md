---
---

Conductor (lab, LAB-148): a run that asked a question is never completed by a pull request an earlier attempt left.

The manager consulted the phase's done-condition before checking whether this attempt had asked for a decision. That condition reports on the branch, and the branch is derived from (epic, issue, phase), so every attempt on a task shares it. Attempt 1 could open a pull request and fail; attempt 2 could then ask a question, stop having produced nothing, and be completed on attempt 1's pull request — withdrawing the question before anyone saw it and recording the phase as succeeded.

The park arm now runs first: a marker is the run stating that it needs a decision about this attempt, so it settles the outcome and the done-condition is not consulted. A run that asked, unblocked itself and finished anyway parks for one round trip rather than completing.

Internal to `labs/conductor`; no published package surface changes.
