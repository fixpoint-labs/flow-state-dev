---
"@flow-state-dev/patterns": patch
---

`createCascadeSkipDependents` now lives on the `task-board` substrate, where it belongs — it's exported from `@flow-state-dev/patterns/task-board` alongside the other board building blocks. It remains available from the package root and from `@flow-state-dev/patterns/plan-and-execute`, so existing imports keep working.
