---
"@flow-state-dev/workforce": minor
---

`workerTaskEntry` takes a `block` instead of a `turn` (one or the other): the block is handed the task itself plus `claim`, the board, partition and row incarnation the gate verified (FIX-1866). `conversationLedgers` exports the entry's resolver for a conversation's board, and `filingConversationBoard(ctx)` finds the board of the conversation a task session was opened for, with the entry that runs it there. A conversation's board now copies a project conversation's project onto the task session it hands over (`filingProjectId`, readonly), and `projectWorkspace()` resolves a run's project from the filing workstream, then the filing project, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user); a task naming another project than its conversation's is refused `other-project`.
