---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
---

Add the `continuation` item type — a structural, client-visible (history-excluded) audit item recording the boundary of a crash-recovery `/continue` re-entry: `trigger`, `priorItemCount` (the durable log's length at re-entry), an optional `resumedAtPath`, and `continuedAt`. It mirrors `suspension_resume`'s shape but marks recovery re-entry rather than a HITL resume, and is exported from the item barrel (`@flow-state-dev/core/items`) alongside it.
