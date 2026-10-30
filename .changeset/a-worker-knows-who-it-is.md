---
"@flow-state-dev/workforce": minor
---

The built-in `agent` worker flow now opens every roster worker's system prompt with who it is: its name (its `WORKER.md` `name:`, else its id's worker segment), its team, its role (its `description`), the teammates it can message by id (a teammate that is also its delegate marked as one that takes its tasks, with a line that work for a delegate goes as a task), and any task-only workers to file a task with. One rule on using tools follows. The team's, the worker's own and its packages' instructions come after, unchanged. Off an installation the layer is absent. `RosterWorker` gains `name` and `teamName`; `workerRecipients`, `rosterDisplayName` and `rosterTeamName` are exported from the package root, and `sendMessage`'s recipient list reads the same `workerRecipients` (FIX-2334).
