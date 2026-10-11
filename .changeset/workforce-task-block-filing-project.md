---
"@flow-state-dev/workforce": minor
---

`workerTaskEntry` takes a `block` instead of a `turn` (one or the other), and its `mailboxLists` accept a list's declaration (`{ id, collection }`) beside its id: the block is handed the task itself plus `claim`, the board, partition and row incarnation the gate verified. `conversationLedgers` exports the entry's resolver for a conversation's board, and `filingConversationBoard(ctx)` finds the board of the conversation a task session was opened for, with the entry that runs it there. A conversation's board now copies a project conversation's project onto the task session it hands over (`filingProjectId`, readonly), and `projectWorkspace()` resolves a run's project from the filing workstream, then the filing project, then the task's `input.project` (`{ visibility, id }`, checked against the run's own user), then the `board` claim; a task naming another project than its conversation's is refused `other-project` (FIX-1866).
