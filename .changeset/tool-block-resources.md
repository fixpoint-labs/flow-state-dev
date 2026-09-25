---
"@flow-state-dev/core": patch
---

Resources declared on a block that a generator lists in its `tools` array now reach `ctx.resources` when the model calls the tool, even when that block is not also a sequencer step or an action. `defineFlow` collects them into the flow's `resources` map with the same rules as any other block, so a tool declaring a different resource under an accessor another block already uses now fails at build time with a resource conflict instead of the tool's declaration being dropped. Tools returned by a function-valued `tools` slot are still not collected (FIX-1578).
