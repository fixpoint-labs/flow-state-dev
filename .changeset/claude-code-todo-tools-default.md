---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now offers every run Claude Code's to-do tools (`TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`) by adding them to the `allowedTools` you pass. On newer models Claude Code offers them outside its terminal only when they are named there, so a run that named none couldn't keep a to-do list and its plan record stayed empty. They ask no permission. A run with `permissionMode: "bypassPermissions"` also gets the search tools `Grep` and `Glob`, which are gated the same way; in other modes they are left to you, since naming them approves searches outside the working directory without asking. To keep a run from any of these, list them in `disallowedTools` (FIX-1947).
