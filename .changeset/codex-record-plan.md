---
"@flow-state-dev/codex": minor
---

`codexAgent` and `codexHarness()` gain opt-in `recordPlan: true`, which writes Codex's confirmed `todo_list` into core's observed-plan record through `replacePlanList`, matching the Cursor harness pattern.