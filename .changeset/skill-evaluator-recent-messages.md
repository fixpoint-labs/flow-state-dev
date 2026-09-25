---
"@flow-state-dev/orchestration": patch
---

`skillEvaluator(model, { recentMessages: N })` lets the skill activator's evaluator see the last N turns before the message, so follow-ups like "yes, do that" activate the skill an earlier offer was about (FIX-1595).
