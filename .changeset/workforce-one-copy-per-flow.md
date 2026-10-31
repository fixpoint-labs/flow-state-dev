---
"@flow-state-dev/workforce": minor
---

Every worker runs on one shared copy of the flow it names (FIX-1788). `hireWorkforce(installation)` returns one copy of each worker flow and the roster flow (`workforce-roster`, with `hire`, `fork`, `edit` and `fire`), and mints nothing per worker and pins nothing. A worker flow declares `session: installation.session()` and loads its worker each turn; `workerFlow(...)` builds a flow in its own file on its installation, and `installation.resourceVisibility` narrows each turn's model to its worker's document grants. The built-in `agent` on an installation keeps each worker's skills apart and refuses a turn whose input names a worker.

Removed from the last publish: `defineHiredRosterCollection`, `reloadHiredSeats`, and `seatAddress` / `splitSeatAddress`. A runtime-hired roster no longer reloads from `workforce/roster/*`; hire and fire write the user's roster through `createWorkerHireBlocks`.
