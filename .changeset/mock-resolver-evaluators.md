---
"@flow-state-dev/testing": patch
---

`createMockModelResolver` takes `evaluators`, keyed by block name, so an evaluator with a model string resolves to a scripted evaluation, and `mockEvaluationModel`'s `answers` can be a function of each call's state (FIX-1610).
