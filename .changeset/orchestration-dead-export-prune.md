---
---

Internal (orchestration, knip config): prune dead internal exports and close the
gap that made the dead-code report untrustworthy. No public API change — none of
the affected symbols was re-exported from any package barrel, so nothing was
reachable through the `@flow-state-dev/orchestration` export map.

**Deleted — referenced nowhere.** `sleep` in `task-board/shared.ts` (its docblock
claimed "used for idle-poll backoff in the worker loop"; the worker loop does not
call it), `BLOCK_LOCATION` in `skills/activation-store.ts`, and the
`SkillClassifierOutput` type in `skills/skill-classifier-gen.ts`.

**Un-exported — used only inside their own module.** `resolveFlowPolicyValue`,
`defaultBoardFlowPolicy`, and `shouldEnableCache` (`task-board/flow-policy-wiring.ts`);
`skillClassifierOutputSchema` (`skills/skill-classifier-gen.ts`); `depsSatisfied`
(`tasks/collection/internal.ts`); and the four `TaskBoardCapabilityOptions` union
arms — `TaskBoardSequencerCapabilityOptions`, `TaskBoardRequestCapabilityOptions`,
`TaskBoardResourceCapabilityOptions`, `TaskBoardFactoryCapabilityOptions`
(`task-board/capability.ts`). The union itself stays exported, so consumers can
still name the options type; only the individual arms — which the export map never
exposed — are now module-local. The `skillClassifierOutputSchema` docblock claimed
it was "public so consumers can mock against this shape", which no export map ever
made true; that claim went with the keyword.

**`goals` is now scanned by knip.** The workspace had no entry config, so knip
treated every goal script as unreachable and reported the symbols they deep-import
from source as dead. `RUN_BOARD_TOOL_NAME` and `agentPurpose` were flagged that way
while `goals/delegation/**/run.mts` imports both on purpose — one goal asserts
against the real `agentPurpose` specifically so a change to the roster rule fails
loudly. Both are kept. Harness scripts stay ignored: they resolve their imports
against `apps/kitchen-sink` by design, so knip cannot resolve them in place and the
gated `knip:ci` categories would fail on them.
