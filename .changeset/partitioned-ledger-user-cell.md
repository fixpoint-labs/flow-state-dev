---
"@flow-state-dev/orchestration": patch
---

A `defineTaskCollection` with `partitionBy` keeps its rows in the user's own cell even on a flow that isolates its user state (`isolateUserState`), so a task entry on another flow finds the row it was handed (FIX-1794).
