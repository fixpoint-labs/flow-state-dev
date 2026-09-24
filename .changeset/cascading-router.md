---
"@flow-state-dev/core": patch
---

New utility: `utility.cascadingRouter` (FIX-1558). Walks a tree of `evaluator` choice questions and runs a block at the leaf. An edge opens only on a matching answer with the model's reported confidence at or above an optional `minConfidence`. Missing or low confidence, or an option with no branch, runs the required `ambiguous` block. Provider errors fail the router.
