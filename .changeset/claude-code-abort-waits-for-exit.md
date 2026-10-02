---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now waits, up to the new `abortExitGraceMs` (default 5000), for the agent's process to exit after an abort before it rejects, so a run stopped right after it starts can be resumed instead of failing with "No conversation found" (FIX-1742). Pass `0` to reject the instant the signal fires.
