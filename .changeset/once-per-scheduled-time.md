---
"@flow-state-dev/scheduled": minor
"@flow-state-dev/core": minor
"@flow-state-dev/bullmq": patch
---

The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
