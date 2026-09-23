---
"@flow-state-dev/workforce": patch
---

`reloadHiredSeats` also returns `byOrg`: one `{ orgId, seats, problems }` per organization passed in, in that order, including organizations with nothing to report. The flat `seats` and `problems` are unchanged. Use it to publish each organization's skipped seats where only that organization reads them.
