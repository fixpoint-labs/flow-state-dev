---
"@flow-state-dev/vercel": patch
---

`vercelPostgresStores()` now backs the `bus` slot with the stores' Postgres bus. It has no tail pool, so it reports `crossesProcesses: false` and open session views across a deployment's instances keep their once-a-second read. A profile left without a bus would otherwise run the in-memory bus, which now reports that it crosses, since it is meant for an app that runs as one process. Each write also sends its change notice through `pg_notify` on the stores' pool (FIX-2545).
