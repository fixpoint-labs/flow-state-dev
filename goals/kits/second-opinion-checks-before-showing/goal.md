# kits › second opinion checks before showing

**Issue:** FIX-2819
**Outcome:** A plain app installs one kit. A draft model answers, a different review model critiques and audits it, and the client receives only the synthesis produced after those checks finish.
**Input:** One `ask` turn on the kit's installed `second-opinion` flow, using goal-local scripted models with distinct draft, critique, audit, and synthesis markers.
**Signal:** The running app completes; the model-resolution log contains both configured model ids in draft-then-review order; critique and audit calls precede synthesis; the capture contains `FINAL_MARKER`, while no client-visible item contains `DRAFT_MARKER`, `CRITIQUE_MARKER`, `debate-verdict`, or `audit-annotation`.
**Anti-game:** The check runs the app through `fsdev run`, not the kit factory. It grades every client-visible capture item and the resolver calls. Both graded lists use `tell.over`, so no calls or messages is CAN'T TELL.
**Model:** Scripted (`@flow-state-dev/testing`); no provider key.
**Run:** `pnpm tsx goals/kits/second-opinion-checks-before-showing/run.mts`
**Controls:** `GOAL_CONTROL=show-draft` makes internal model items client-visible and must fail the hidden-draft assertion. `GOAL_CONTROL=one-model` routes the draft through the review model and must fail the two-model assertion.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|---|---|---|---|---|
