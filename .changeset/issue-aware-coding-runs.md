---
"@flow-state-dev/harness-manager": minor
---

A coding run can be told which tracker issue it is for. A harness session takes `state.issue` at create, fixed like the model, and hands it to the workspace as `place.issue`. On a board read from the claim, a task names its issue with `harnessFeature: { issue }`, and the phase is now optional. The run's branch leads with the issue, and a run already under way keeps its recorded branch. The new `issueSpec` option on `harnessSessionFlow` and `harnessManager` opens the brief with the issue's spec from the run's checkout. It is off by default. Phases see the issue as `trackerIssue` (FIX-2388).
