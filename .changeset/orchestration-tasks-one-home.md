---
"@flow-state-dev/orchestration": minor
---

**Breaking:** the task substrate's names are no longer exported from the `@flow-state-dev/orchestration` root. Import them from `@flow-state-dev/orchestration/tasks`, their one home, which is safe to bundle for a browser (FIX-2459). This covers every name on `./tasks`, about 220, among them `defineTaskCollection`, `getOrCreateTaskCollection`, `taskSchema`, `Task`, `TaskCollectionRef`, `flowPolicy`, `ticketForClaim`, `beginTaskWrite`, `onTaskChangeFor` and `ShownSteer`. There are no deprecated aliases: an old root import fails to compile with "has no exported member". The root keeps skills, the frontmatter helpers, `resolveCatalogTools`, `isTaskTurn`, the `taskSettledEntry` family, `payBoardDebts` / `settlePassWake` and the lease-renewal scope.

Docs: packages/orchestration/README.md, packages/patterns/README.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/orchestration/flow-policy.md, apps/docs/docs/sequencers/wait-for-condition.md (import task names from `@flow-state-dev/orchestration/tasks`, not the root; the orchestration README's header line "depends only on core" is also wrong, it depends on client too)
