---
"@flow-state-dev/workforce": minor
---

A coordinator's post to each delegate is now one task row on the conversation's board, and the board's claim decides that an answer lands once. Three things for an app to change or expect:

- A worker file whose `tools:` names `handOff` is refused at load. Hand a post on with `dispatchTask` and `post: true`, naming the delegate as `assignee` (and a workstream's `target`). `dispatchTask` is on every coordinator, so `tools:` doesn't name it.
- A delegate flow declares the post entry under `task` entries: `task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } }`. Declaring it under `internal` makes `defineCoordinatorFlow` throw. `delegatedAnswerSchema` and `DelegatedAnswer` are removed.
- A conversation saved with the old delivery ledger reads as if it had none and drops it at its next write. An answer still owed for a post delivered before the upgrade is dropped, and its round closes at its deadline, so a conversation with `rounds:` set can lose one round of answers once.
