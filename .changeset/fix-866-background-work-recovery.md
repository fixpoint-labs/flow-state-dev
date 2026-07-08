---
---

Internal (FIX-866): verify-and-harden regression coverage for crash-recovery of attached durable background work (`.work()` / `.forEachBackground()`) — mid-drain partial fan-out, failed-task-under-completed-parent, and cross-store (SQLite + Postgres) completed-trace replay — plus documentation of the contracts. No runtime or public API changes.
