---
"@flow-state-dev/harness-manager": patch
---

A phase's `isDone` now gets `baseCommit`: the commit the run's branch was cut at, from the run's record (`null` with no recorded base or a files-only run). A phase can compare the checkout against it to tell whether the run changed anything (FIX-2387).
