---
"@flow-state-dev/contracts": patch
---

A resumed request now hands the next step the real result of an earlier `.asTool()` step, because a recorded value that points at a tool result resolves to that result instead of `undefined` (FIX-1847).
