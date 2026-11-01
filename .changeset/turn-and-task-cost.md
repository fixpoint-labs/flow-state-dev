---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/harness-manager": minor
---

`taskSpendView` gains `costUsd`: the sum of the charges vendors reported for the task, or `null` when none did (a subscription run reports none). `requestSpendView` reads one request's spend the same way. `harnessSessionFlow` records what each turn spent on its turn record (`spend`, in `taskSpendView`'s shape, and `endedAt`), hands harnesses an `onUsage` feed that records subscription windows in the user's usage record, and carries a `harnessUsage` action that reads it, with optional `usageReaders` (FIX-2398).
