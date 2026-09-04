---
---

Internal only — a falsification baseline for FIX-981 (durable-jobs M1). Adds a
two-executions-over-one-durable-board characterization to the integration suite
and a `durable-claim-safety/two-executions-one-task` goal check on real SQLite.
No package surface changes; the user-facing claim-ticket change ships later in
the issue's PR plan.
