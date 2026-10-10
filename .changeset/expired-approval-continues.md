---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

An approval that passes its `expiresAt` no longer leaves its request suspended: the durability sweeper carries the turn on as if the approval were rejected, so the gated tool does not run, the model gets a result saying the approval expired and is no longer valid, and `SuspensionRejectedError` carries `expired: true` (FIX-1846).
