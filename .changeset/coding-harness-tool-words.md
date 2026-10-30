---
"@flow-state-dev/shift-manager": patch
---

A coding run's tool calls read the same on Claude Code, Codex and Cursor: `Bash`, `command_execution` and `shell` are all "ran a command", `Edit`, `edit` and Codex's `file_change` are all "edited a file", and `Grep` is "searched the code", where some showed as the tool's bare name before (FIX-2343).
