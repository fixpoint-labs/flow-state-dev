---
"@flow-state-dev/store-sqlite": patch
---

Add two indexes that serve the session stream's repeated reads: one session's requests, and one parent's runs, each newest-updated first. Each read now walks what changed rather than sorting the session's history. Created with `IF NOT EXISTS` on the next open; no data changes (FIX-1609).
