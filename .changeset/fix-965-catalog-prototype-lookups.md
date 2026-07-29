---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

Fix catalog and task lookups so ids or keys colliding with `Object.prototype` members (`constructor`, `toString`, …) or the special `__proto__` key are always handled correctly — resolved as a genuine miss when unset, and reliably stored and retrievable when set.
