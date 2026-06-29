---
---

FIX-760: Add durable per-position thesis records to the private `@flow-state-dev/trading-desk` example. A holding can now carry a thesis — entry rationale, freeform invalidation conditions plus structured tripwires, time horizon, optional target/stop, and a link to the report it came from — stored per name at the household level in the app-owned relational layer. When the desk analyzes a held name it injects the standing thesis into the trader and PM (the analysts stay blind), and a finished report can be adopted as a thesis in one action. Editable from the Portfolio view. No publishable package surface changes.
