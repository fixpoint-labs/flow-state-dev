---
"@flow-state-dev/workforce": minor
---

The `./loader` subpath publishes the walk every workforce-tree reader shares — `openRoot`, `walkTeams`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable` and `IGNORED_ENTRIES` — and with it every reader now refuses a symlinked root and tags every `readWorkforceDirectory` failure with a `kind` (FIX-1389).
