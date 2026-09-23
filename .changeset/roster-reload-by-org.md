---
"@flow-state-dev/workforce": patch
---

`reloadHiredSeats` also returns `byOrg`, one `{ orgId, seats, problems }` per organization passed in, so each organization's skipped seats can be reported to that organization alone (FIX-1477).
