---
"@flow-state-dev/core": patch
---

`assertEvaluatorBlock(block, { slot, helper, questions })` refuses a value in an evaluator slot that is not an evaluator block, with one message shape shared by every package that takes an evaluator option (FIX-1555).
