---
"@flow-state-dev/harness-manager": minor
---

On a board read from the claim, feature work is now named only under `HARNESS_FEATURE_KEY` (`"harnessFeature"`): `input: { harnessFeature: { issue, phase } }`. The rest of a task's `input` is the filer's own, so a task whose fields include a plain `issue` (a model's word for "the problem") runs as an ordinary task instead of being refused as half a feature payload (FIX-2282). `namesHarnessFeature(input)` and `harnessFeatureOf(input)` read the key the way the manager does.

**Migration.** A flow that files feature work on a conversation's board must move `{ issue, phase }` under `harnessFeature`; a task carrying them at the top of `input` now runs as the manager's phase with its task id standing in for the issue. Fixed boards are unchanged: their rows carry `{ issue, phase }` at the top of `input`, as before.
