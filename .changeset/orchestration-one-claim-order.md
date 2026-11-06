---
"@flow-state-dev/orchestration": minor
---

**Breaking:** the task board has two named claim orders, `"fifo"` and `"priority"`, and `"fifo"` is the default (FIX-2459). `topologicalClaimOrder` and the `"topological"` name are removed. They had `fifoClaimOrder`'s body: neither claims a task with unmet `deps`, because the collection's own admission rule gates on them. A board that names no claim order behaves as before. Replace `claimOrder: "topological"` with `claimOrder: "fifo"` (or drop the option), and `topologicalClaimOrder` with `fifoClaimOrder` from `@flow-state-dev/orchestration/tasks`. There is no alias: the old name fails to compile.

Docs: packages/orchestration/README.md, packages/patterns/README.md, apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/orchestration/configuration.md, apps/docs/docs/glossary.md, apps/docs/guides/building-a-research-team.md (two claim orders, `fifo` the default; drop `topologicalClaimOrder` and the "behave identically" line; `claimOrder: "topological"` examples become `"fifo"` or drop the option)
