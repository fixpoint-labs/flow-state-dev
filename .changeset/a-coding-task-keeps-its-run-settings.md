---
"@flow-state-dev/harness-manager": minor
---

A coding task runs on the run settings its first claim froze, for its whole life (FIX-2878).

- **The run starts on the task's harness.** The harness kit's coding flow now runs a task on the harness the server filled on it at filing. It falls back to its worker's `harness:` line, then the kit's `defaultHarness`, only for a task that carries none. A no-pick filing to a worker whose own `harness:` names another harness runs on the default.
- **The first claim freezes the settings.** It writes the harness, the model, the plan setting, the review mode and the task's mode on the run record (`frozenHarness`, `frozenModel`, `frozenPlan`, `frozenReview`, `frozenMode`). Every later attempt, a steer, a message, a line typed in the run's session, and the `harness` action read them. A change to a worker's file or to the kit's defaults reaches only tasks not yet claimed. A frozen harness the app no longer has fails the task by name (`harness_removed`). The worker's `lock:` is checked against the frozen settings at every claim.
- **Breaking: a run from before this change starts a fresh session, once.** A run record that froze no settings and holds a session is not resumed at its next claim, because that session may be another harness's. That claim freezes the settings. A line into a finished task whose record froze none is refused (`SessionDoorRefused`, reason `before-run-settings`) and says to file a new task.
- **`harnessManager`'s input takes `runSettings`**: the settings a host resolved for the task, which an attempt whose record froze none writes. Without it nothing is frozen, as before.
- **`source` is no longer written** on the run record. It can't tell two harnesses apart. A stored one still parses.
- **The coding board** shows a task's filled harness before any run reports one.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (the run settings a task keeps once claimed, the fresh session at upgrade, and the `before-run-settings` refusal)
