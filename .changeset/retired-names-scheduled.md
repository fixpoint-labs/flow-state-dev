---
"@flow-state-dev/scheduled": patch
---

`createScheduledTransportAdapter` refuses the retired `idempotencyWindowMs` and `idempotencyOptions` with `RetiredNameError`, which names scheduled 0.6.0 as the version that removes the refusal (FIX-2454).

Docs: none
