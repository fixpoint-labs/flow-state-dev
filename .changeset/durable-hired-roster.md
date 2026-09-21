---
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A flow can now be registered and unregistered after the runtime is built, and a workforce hired at runtime can be stored and read back at the next start (FIX-1475).

`FlowState.register(flow)` admits one instance at any time and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs. A flow registered this way is served from the next request onward in that process; a request already running is never cancelled or truncated by an `unregister`. `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served — a change in value for an app whose `flows` record keys differ from its instance ids.

`defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, one row per runtime-hired seat, and `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole roster back at boot and returns `{ seats, problems }` for the caller to register one at a time. A stored row naming a kind the code no longer has is skipped and named rather than failing the start; a read the store will not complete, or more organizations than the cap, rejects without returning a partial roster. `seatAddress(orgId, seatId)` is the address a hired seat answers on.
