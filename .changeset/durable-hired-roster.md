---
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A flow can now be registered and unregistered after the runtime is built — `FlowState.register(flow)` admits one instance and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs, and a flow registered this way is served from the next request onward without cancelling one already running (FIX-1475).

A workforce hired at runtime now survives a restart: `defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole one back at boot as `{ seats, problems }` for the caller to register a seat at a time, and `seatAddress(orgId, seatId)` is the address a hired seat answers on (FIX-1475).

Migration: `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served. An app whose `flows` record keys differ from its instance ids will read different values there than before.
