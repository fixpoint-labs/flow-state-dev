---
"@flow-state-dev/patterns": patch
---

`routedSpecialists` now records a failed dispatch correctly: its rescue handler runs in the outer loop's scope where `currentTaskId` lives, so a failing specialist marks its task failed (previously the wrapper sub-sequencer's fresh state left `currentTaskId` unset). `response-auditor` and `routedSpecialists` drop their per-item wrapper sub-sequencers in favor of a leaf `.rescue()`.
