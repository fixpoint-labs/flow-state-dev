---
"@flow-state-dev/orchestration": minor
---

`createSkillActivator` takes a new `enableKeywordMatch` option (default `true`, preserving today's pipeline). Set it `false` to drop tier 2 (keyword scan) from the activator pipeline entirely, leaving only the slash tier and, if enabled, the classifier — useful for a caller whose activation contract has no keyword tier (FIX-1363).
