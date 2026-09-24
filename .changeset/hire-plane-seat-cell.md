---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/scheduled": patch
---

A hired seat now keeps what it saves for a person (shared user-scoped resources, user state, and its dynamic schedules) in one cell per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Hired seats' stored data" (FIX-1538).
