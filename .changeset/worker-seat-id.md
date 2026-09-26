---
"@flow-state-dev/workforce": minor
---

Every hired seat now carries its own id as the `seatId` setting (for a runtime-hired seat, its roster id, the one a channel's `members:` lists), a `WORKER.md` that sets `seatId:` is refused by name, and a worker kind whose settings schema is hand-written rather than built from `workerConfigSchema()` must admit `seatId` or it refuses at boot naming the key (FIX-1589).
