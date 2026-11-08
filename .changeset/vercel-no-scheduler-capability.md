---
"@flow-state-dev/vercel": minor
---

**Breaking:** `vercelPostgresStores()` no longer lists `scheduler` in its `capabilities`, which are now `["primary", "bus"]` (FIX-2452). The `scheduler` profile slot is gone from engine; the adapter's `scheduleIndex` is unchanged and is still how scheduled flows reach the index. A profile that wired this adapter into `scheduler:` fails to compile: delete that line.

Docs: FIX-2452. packages/vercel/README.md: drop `scheduler` from the adapter's capabilities and any `scheduler:` profile line; show `stores: vercelPostgresStores()` as the bare form.
