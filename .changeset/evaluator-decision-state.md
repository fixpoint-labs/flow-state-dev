---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
---

Evaluators work with `@ai-sdk/gateway` 4.0.108 and later: core now requires `ai` 7.0.133 or later, which sends an evaluator's state the way those versions read it, and an array state still reaches the model as the array it is. `mockEvaluationModel` hands its `answers` function, and records on `calls`, the state the evaluator evaluated (FIX-1925).
