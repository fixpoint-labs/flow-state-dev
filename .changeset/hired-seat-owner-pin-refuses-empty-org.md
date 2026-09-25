---
"@flow-state-dev/workforce": minor
---

`hiredSeatOwnerPin` now refuses a missing or empty organization id with the same error `registerHiredSeat` throws, instead of returning a pin with an empty `orgId` (FIX-1572).
