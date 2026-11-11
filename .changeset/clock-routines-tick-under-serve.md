---
"@flow-state-dev/workforce": patch
---

Clock routines fire under `serve()` when the host passes `hireWorkforce(installation, { routines: { index } })` (FIX-2674). The roster flow now names that index in its `schedules`, so `serve()`'s schedule tick claims its due entries. Before, saved schedules were written to the index but no tick read them, so they never fired.

Docs: none. The documented setup was right; it now works as written.
