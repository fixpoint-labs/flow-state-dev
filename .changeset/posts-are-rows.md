---
"@flow-state-dev/workforce": minor
---

A coordinator's hand-off to each delegate is now one task on the conversation's board, and the board's claim decides that an answer lands once. (FIX-1872) Things for an app to change or expect:

- A worker file whose `tools:` names `handOff` is refused at load. A coordinator hands a message on by filing a task (see the routed-tasks note in this release). `delegatedAnswerSchema` and `DelegatedAnswer` are removed.
- A conversation saved with the old delivery ledger reads as if it had none and drops it at its next write. An answer still owed for a post delivered before the upgrade is dropped, and its round closes at its deadline, so a conversation with `rounds:` set can lose one round of answers once.
