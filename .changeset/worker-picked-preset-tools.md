---
"@flow-state-dev/workforce": minor
---

A worker on the built-in `agent` kind with no `tools:` line can now call the tools of the capability presets its file picks under `capabilities:`, where before it got only their context. Write `tools: []` to keep the old reach; a worker that writes a `tools:` line is unchanged. For a worker with no line, the hired seat's `config.tools` is now absent rather than `[]`, and the worker is refused at startup if two presets it picks list different tools under one name (FIX-1459).
