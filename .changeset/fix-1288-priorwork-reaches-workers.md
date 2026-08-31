---
"@flow-state-dev/orchestration": patch
---

Task Board workers that declare `taskWorkerInputSchema` as their `inputSchema` now actually receive `priorWork`. The schema had no `priorWork` key, and Zod strips what a schema doesn't name, so the flow policy's selection was packed by the board and then dropped before any such worker could read it. Workers on a board with a configured `flowPolicy` (or the default `declaredDepsOnly` where a task declares deps and its dependencies made tool calls) will start seeing the slot populated; boards whose policy selects nothing are unchanged, and the key stays absent rather than present-and-`undefined` (FIX-1288).
