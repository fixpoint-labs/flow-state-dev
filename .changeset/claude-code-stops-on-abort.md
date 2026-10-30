---
"@flow-state-dev/core": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/harness-manager": patch
---

A harness can declare `stopsOnAbort` on the block it returns (an optional field on core's `HarnessBlock`): its abort settles only once its run's process has exited. `claudeCodeAgent` declares it. A harness manager built without `stopsOnAbort` now reads the harness's declaration, so a line typed into a running Claude Code task stops the run and the same request continues its session with the line. Set `stopsOnAbort: false` on the manager to keep the old behavior, where the line waits for the run's own end (FIX-2312).
