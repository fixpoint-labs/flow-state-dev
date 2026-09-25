---
"@flow-state-dev/core": patch
---

Resources declared on a block that a generator lists in a static `tools` array now reach `ctx.resources` when the model calls the tool, including when a `uses` capability also contributes tools, and a conflicting declaration at the same accessor now fails at `defineFlow` time (FIX-1578).
