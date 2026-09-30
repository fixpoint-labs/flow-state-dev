---
"@flow-state-dev/fsdev": patch
---

`declaredDevtoolConfig(flowState)` is now exported: the `devtool` block (user and bearer) an app's `fsdev.config.*` declares, or `undefined` when the block is empty, exactly as `fsdev dev` reads it. A host that serves its own pages through `serve()` can hand the same config to them.
