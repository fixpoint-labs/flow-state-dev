---
"@flow-state-dev/patterns": minor
---

`parallelTasks` and `planAndExecute` are now expressed on the `goalSeekLoop` primitive. Behavior is preserved with two observable changes: each pattern now emits one additive `goal-seek-loop-termination` item when it finishes, and a custom `planAndExecute` `evaluator` with no built-in iteration cap now runs exactly `maxIterations` drains (previously `maxIterations + 1` — the iteration budget is now uniform "total drains" for every evaluator). The default evaluator is unaffected. Public factories, config, and output shapes are unchanged.
