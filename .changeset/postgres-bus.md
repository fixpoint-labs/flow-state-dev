---
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/engine": patch
---

`postgresStores` now backs the `bus` slot, so on a host with more than one process over one Postgres a session view open on one process sees a change saved on another as soon as it is saved, and an idle view costs the database nothing. Each process with an open view holds one listening connection from `liveTailPool` and pings itself through it every 2 s; it reports `crossesProcesses: true` only while the ping comes back, so behind a transaction pooler (or after a silent drop) views keep the once-a-second read, and the process logs one warning naming the fix (a `liveTailPool` on a direct connection string). `createPostgresStores` returns the bus as `registry.bus`, and `close()` hands its connection back before ending the pools. Without a tail pool (`liveTailPool: null`, `{ pool }` without one, `{ executor }`) the bus stays in process. In `@flow-state-dev/engine`, `withChangeBus` now refuses stores that already publish to a different bus instead of publishing to both, a write's notice reaches subscribers one microtask sooner, and a notice that can't be assembled is debug-logged (FIX-2427).
