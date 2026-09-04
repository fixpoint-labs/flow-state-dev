---
"@flow-state-dev/orchestration": patch
---

A task handed to a child session now takes its row back and runs when the child starts after the lease has lapsed, instead of refusing the dispatch and waiting for another drain to spend an attempt re-dispatching it (FIX-1305) — `renewLease` gains `adoptLapsedLease` for that takeover, tasks record the lease duration their claim was granted as `leaseDurationMs`, and `committedLeaseSpan(task)` reads it back.
