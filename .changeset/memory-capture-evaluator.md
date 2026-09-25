---
"@flow-state-dev/memory": patch
---

`system()` takes an optional `evaluator` that decides, before the observer runs, whether a turn is worth remembering: `remember` observes it as before, `skip` writes nothing and marks it read. `captureEvaluator(model)` builds that block on the app's model, and `captureQuestions` is its question for apps that build their own. Without an evaluator, capture is unchanged (FIX-1555).
