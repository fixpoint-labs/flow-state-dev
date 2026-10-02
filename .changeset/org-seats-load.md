---
"@flow-state-dev/workforce": minor
---

Seats declared under `org/workers/` now load, with their folder name as their id. An org seat reads the org's skills, packages and references, then its own folder's. `parseDeclaredSeatId` reads a declared seat's id back into its team (if any) and name (FIX-1719).
