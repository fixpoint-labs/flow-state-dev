---
"@flow-state-dev/core": patch
---

The run's plan record is now part of the harness contract in `@flow-state-dev/core`: `OBSERVED_PLAN`, `observedPlanCollection`, `observedPlanItemStateSchema` and `ObservedOutcome`, with the same key and fields as before, and entries now stream to an open page as they change. New beside it: a per-run list marker (`OBSERVED_PLAN_LIST`, `observedPlanListCollection`) that says whether a run's plan is `writing`, `complete` or `incomplete`, and `replacePlanList(plan, marker, runNamespace, items)` for harnesses whose plan arrives as the whole list. Also new: `harnessFailureKind(error)`, which returns `"unknown-conversation"` when a harness refused to continue the conversation a run asked to resume, and `null` for any other failure (FIX-1915).
