---
"@flow-state-dev/patterns": minor
---

**Breaking:** the building blocks and schemas of the plan-and-execute, supervisor, routed-specialists, event-actors, round-robin and debate patterns no longer come from the package root, with no alias. Import them from the pattern's own entry, for example `import { createLabelFailedReviews } from "@flow-state-dev/patterns/supervisor"`. The root keeps each pattern's factory (`planAndExecute`, `supervisor`, `routedSpecialists`, `eventActors`, `roundRobin`, `debate`), its input schema and its config types (FIX-2705).

- `@flow-state-dev/patterns/plan-and-execute`: `planAndExecuteStateSchema`, `PlanSchema`, `PlanTaskSchema`, `iterationOutputSchema`, `evaluatePlanProgress`, `createTaskEvaluator`, `createLLMEvaluator`, `createCaptureAndPlan`, `createApplyReplan`, `createBuildPlanOutput`, `normalizeOutputStatus`, and the types `PlanAndExecuteState`, `Plan`, `PlanTask`, `IterationOutput`.
- `@flow-state-dev/patterns/supervisor`: `supervisorInputSchema`, `supervisorStateSchema`, `plannerOutputSchema`, `buildReviewedWorker`, `createLabelFailedReviews`, and the types `SupervisorState`, `ReviewerVerdict`, `ReviewerInput`, `PlannerOutput`. The root's `createSupervisorCaptureAndPlan` and `createSupervisorSynthesize` are `createCaptureAndPlan` and `createSynthesize` there.
- `@flow-state-dev/patterns/routed-specialists`: `controllerOutputSchema`.
- `@flow-state-dev/patterns/event-actors`: `matchTopic`, `compilePattern`, `createAppendEntry`, `normalizeToEntries`.
- `@flow-state-dev/patterns/round-robin`: `roundRobinStateSchema`, `roundRobinContributionEntrySchema`, `roundRobinRefereeOutputSchema`, `roundRobinRefereeCritiqueSchema`, `createRoundRobinContributions`, `createRosterAgent`. The root's `createRoundRobinReferee`, `createRoundRobinSynthesize`, `createRoundRobinInitContributions` and `createRoundRobinRecordContribution` are `createReferee`, `createSynthesize`, `createInitContributions` and `createRecordContribution` there.
- `@flow-state-dev/patterns/debate`: `debateStateSchema`, `debateContributionEntrySchema`, `debateVerdictSchema`, `debateTranscriptStateSchema`, `createDebateTranscript`, `createDebater`.

Docs: apps/docs/docs/reference/upgrading/2026-11-24.md (a `patterns` row: the patterns' building blocks and schemas leave the root; import them from the pattern's subpath)
