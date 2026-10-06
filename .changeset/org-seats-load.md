---
"@flow-state-dev/workforce": minor
---

Seats declared under `org/workers/<name>/` now load as org seats, with the folder name as their id, and `parseDeclaredSeatId` reads any declared seat's id back into its team (if any) and name (FIX-1719).
