---
"@flow-state-dev/core": minor
---

`defineFlow` takes `resourceVisibility`, a per-turn rule for which of the flow's resources the model's resource tools reach. A resource it hides is absent from listing, search and the discovery door, and answers "not found" when named; a read-only one is read but not written. Omitted, nothing changes (FIX-1788).
