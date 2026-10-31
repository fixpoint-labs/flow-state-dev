---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's coder can be Codex or Cursor as well as Claude Code (`DEVFORCE_LAB_HARNESS=codex` or `cursor`), each refused at start when it isn't signed in. One run may now take 20 minutes by default, and `DEVFORCE_LAB_RUN_MINUTES` sets it (FIX-2390).
