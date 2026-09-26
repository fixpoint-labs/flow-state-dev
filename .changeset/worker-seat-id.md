---
"@flow-state-dev/workforce": minor
---

Every hired seat now carries its own id as the `seatId` setting, so a block inside the seat can sign what it files or posts. A `WORKER.md` that sets `seatId:` is refused by name, and a worker kind whose settings schema is hand-written rather than built from `workerConfigSchema()` must admit `seatId` or it refuses at boot naming the key (FIX-1589).
