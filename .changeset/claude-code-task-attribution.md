---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now puts the task's id on every item it emits when it runs inside a task, as the Codex and Cursor harnesses do, so a task's own view shows the run's messages, reasoning and tool calls (FIX-1692).
