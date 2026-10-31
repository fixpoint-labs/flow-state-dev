---
"@flow-state-dev/core": patch
---

A request suspended inside the model's `waitForUser` tool before it was renamed `suspendForUser` (FIX-2317) resumes when the user answers. Before this, answering it failed with `GeneratorToolUnavailableError`. The resumed step runs `suspendForUser` under the old name's path, so the stop matches the answer already given. The model never sees the old name.
