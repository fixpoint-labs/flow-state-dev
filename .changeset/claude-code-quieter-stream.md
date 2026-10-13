---
"@flow-state-dev/claude-code": patch
---

The Claude Code block's stream is quieter and says more about what the run is doing. Thinking with no text no longer produces an empty `reasoning` item, which also lets consecutive tool calls group. Each tool call updates the live `status` with its own `description` (or `Using <tool>…`). The "session started" status on system init is gone.
