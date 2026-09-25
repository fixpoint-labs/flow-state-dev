---
"@flow-state-dev/orchestration": patch
---

`createSkillActivator` takes an optional `evaluator` for tier 3, with `skillEvaluator(model)` and `skillQuestions` to build one (FIX-1559). The evaluator picks one skill or none from the same catalog the classifier would see, and its pick is final: no confidence threshold, no fallback to the classifier. Without it, activation is unchanged.
