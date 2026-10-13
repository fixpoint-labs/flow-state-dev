---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now offers every run Claude Code's to-do tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) by adding them to the `allowedTools` you pass. On newer models Claude Code offers them outside its terminal only when they are named there, so a run that named none couldn't keep a to-do list and its plan record stayed empty. They ask no permission. To keep a run from them, list them in `disallowedTools` (FIX-1947).
