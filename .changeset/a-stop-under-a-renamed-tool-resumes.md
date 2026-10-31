---
"@flow-state-dev/core": patch
---

A request suspended inside the model's `waitForUser` tool before it was renamed `suspendForUser` (FIX-2317) resumes when the user answers. Before this, answering it failed with `GeneratorToolUnavailableError`. When the resolved tools have nothing by the old name, the resumed step runs `suspendForUser` under the old name's path, so the stop matches the answer already given. A tool of an app's own that still has the old name resumes as itself. The model never sees the old name.
