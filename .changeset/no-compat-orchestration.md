---
"@flow-state-dev/orchestration": minor
---

The task shapes no published orchestration wrote (`questions`, `keptOpenBy: "wait"` or `"queued"`, the recorded-not-started mark, `reopened`, a post row) no longer read, and `taskSchema` refuses `keptOpenBy: "wait"`. The board's `onReview` option, the collection's `"sequencer"` and `"request"` backings, and a SKILL.md `agents:` block are no longer refused by name: the backings fail as unknown backings, and `onReview` and `agents:` are ignored like any unknown key. `SkillAgentsRemovedError` is gone. Also gone are the refusals of `expectAttempt`, an assignee's `dispatch: { mode }`, `{ block, session }` or `{ worker, dispatch }` (still refused as not a block), SKILL.md `context: fork` / `pattern`, `pattern:` and `workers:`, `createTask`'s `waitForResponse` and `updateTask`'s `question`. A stored `status: "blocked"` row still reads as `held` (FIX-2454).

Docs: packages/orchestration/README.md (drop "a row stored with the old names still reads"; only a stored `blocked` row reads, as `held`). The old names and shapes are removed outright, with no refusal message.
