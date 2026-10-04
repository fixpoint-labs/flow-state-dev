---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now waits, for up to 5 seconds, for the agent's process to exit after an abort before it rejects, so a run stopped right after it starts can be resumed instead of failing with "No conversation found" (FIX-1742).
