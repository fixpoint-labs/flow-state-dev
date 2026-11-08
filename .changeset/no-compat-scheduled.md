---
"@flow-state-dev/scheduled": patch
---

`createScheduledTransportAdapter` no longer refuses `idempotencyWindowMs` or `idempotencyOptions`; each is an unknown option that nothing reads (FIX-2454).

Docs: apps/docs/docs/server/scheduled.md and packages/scheduled/README.md (drop the lines that say the adapter throws on `idempotencyWindowMs` or `idempotencyOptions`). The old names are removed outright, with no refusal message.
