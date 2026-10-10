---
"@flow-state-dev/workforce": patch
---

`workerTaskEntry` takes a `block` instead of a `turn` (one or the other): the block is handed the task itself plus `claim`, the board and partition the gate verified. `conversationLedgers` exports the entry's resolver for a conversation's board. A conversation's board now copies a project conversation's project onto the task session it hands over (`filingProjectId`, readonly), and `projectWorkspace()` resolves a run's project from the filing workstream, then the filing project, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user), then the `board` claim; a task naming another project than its conversation's is refused `other-project` (FIX-1866).
