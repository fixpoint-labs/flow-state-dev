---
"@flow-state-dev/orchestration": minor
---

A task row stored with `status: "blocked"` still reads as `held`; the task row shapes no published orchestration wrote (`questions`, `keptOpenBy: "wait"` or `"queued"`, the recorded-not-started mark, `reopened`, a post row) no longer read, and `taskSchema` refuses `keptOpenBy: "wait"`. The board's retired `onReview` and `dispatcher` options (use `claimOrder`), the collection's `"sequencer"` and `"request"` backings (use `backing: "state"`), and a SKILL.md `agents:` block now throw `RetiredNameError`, each naming its replacement and orchestration 0.8.0, the version that removes it; `SkillAgentsRemovedError` is one. Refusals of names no published version accepted are gone: `expectAttempt`, an assignee's `dispatch: { mode }`, `{ block, session }` or `{ worker, dispatch }` (still refused as not a block), SKILL.md `context: fork` / `pattern`, `pattern:` and `workers:`, `createTask`'s `waitForResponse` and `updateTask`'s `question` (FIX-2454).

Docs: packages/orchestration/README.md (drop "a row stored with the old names still reads"; only a stored `blocked` row reads, as `held`)
