---
"@flow-state-dev/core": patch
---

New `planRowsPrefix(requestId)` and `planKeySegment(value)`, from the package root and `@flow-state-dev/core/types`: the key prefix one request's plan entries (or, with `OBSERVED_PLAN_LIST`, its markers) are under, for reading one turn's plan with a `topicPrefix`, and how a request id or run name is written as one key segment (FIX-1915).
