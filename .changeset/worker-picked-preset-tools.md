---
"@flow-state-dev/workforce": minor
---

A worker on the built-in `agent` kind with no `tools:` line can now call the tools of the capability presets its file picks under `capabilities:`, where before it got only their context; write `tools: []` to keep the old reach, and a worker that already writes a `tools:` line is unchanged (FIX-1459).
