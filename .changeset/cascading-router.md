---
"@flow-state-dev/core": patch
---

New `utility.cascadingRouter` walks a tree of `evaluator` choice questions and sends anything the model didn't answer with enough reported confidence to one required `ambiguous` block (FIX-1558).
