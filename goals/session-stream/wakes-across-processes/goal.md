# session-stream › it wakes across processes

**Issue:** FIX-2427
**Outcome:** On two or more processes over one Postgres, a change saved on any process reaches every open view of it on the others within a second, and a view where nothing changes costs the database nothing; whenever Postgres can't carry the notices, views keep the one-second read and miss nothing.
**Input:** Two processes (`child_process.fork`, through `goals/lib/peers.mts`), each `createFlowState` with `postgresStores` at its defaults, over one real Postgres that `goals/lib/postgres.mts` starts (`initdb`, `pg_ctl`) or `FSD_DB_URL`. Process 1 answers in a session with a handler that writes only items and a status (a plain reply), and starts a background run through a dispatcher. Process 2 holds two open views of the session (`GET /sessions/:id/stream`). Every statement process 2 sends, on any of its connections, passes one counting `pg.Client` (`poolOptions.Client`, which the tail pool inherits); the bus's own ping and `LISTEN` are counted apart. Held-out: any reply text and any run key must pass.
**Signal:**
- `1:reply` — process 2's view receives process 1's reply less than 1000 ms after process 1 saved it (polled off process 1's store every 5 ms).
- `1:run` — process 2's view names process 1's background run in `session.runs` less than 1000 ms after the run's start is saved; started after a quiet interval, since a view reads at most once an interval.
- `2:idle` — over a 10 s idle window with two views open, process 2 makes 0 statements for its views; its bus pings at most 6 times (one per 2 s, plus one).
- `3:drop` — with process 2's view idle and waiting, its listening backend is terminated (`pg_terminate_backend`); one reply from process 1, with no write after it, reaches the view within 10 s. `3:back` — once process 2's bus says it crosses again, the next reply arrives within 1000 ms.
- `4:no-tail` — with `liveTailPool: null` on both, process 2's bus says it does not cross, and the reply arrives within 2000 ms, on the timed read.

**Anti-game:** Not `pg_notify` calls and not a mocked pool: both pass while process 2 stays empty. Every assertion reads what process 2's stream delivered or what process 2 asked the database. One process with two registries is not two processes, and PGlite can't `LISTEN` across them. `2:idle` is floored on everything process 2 sent in the window, so a count that never reached its connections is CAN'T TELL, not a pass.
**Model:** n/a
**Run:** `pnpm tsx goals/session-stream/wakes-across-processes/run.mts` (root needs a `postgres` user to run `initdb` as; or set `FSD_DB_URL`)
**Controls:**
- `GOAL_CONTROL=no-listen` — the bus never `LISTEN`s but says it crosses (a scratch patch to `packages/store-postgres/src/bus.ts`). Must FAIL `1:reply`. It fails `3` and `4` too: the patch says "crosses" with no tail pool as well.
- `GOAL_CONTROL=trust-listen` — the bus trusts a `LISTEN` that succeeded: no ping, and a lost connection changes nothing. Must FAIL `3:drop`.
- `GOAL_CONTROL=no-bus` — today's `main`: the Postgres adapter declares no `bus`, so each process gets an in-memory one (a scratch patch to `packages/store-postgres/src/index.ts`). Must FAIL `2:idle`: process 2's two views read the store 4 times a second each.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | fix/FIX-2427-postgres-bus (pre-commit) | n/a | PASS ×3 runs | initdb, PG 16. 2: 0 view statements, 5 pings in 10 s idle, two views · 1: reply 105–117 ms, run 112–165 ms after it started · 3: 1 listener terminated, reply 431–468 ms after saved; back, next reply 111–117 ms · 4: reply 481–487 ms on the timed read |
| 2026-11-03 | fix/FIX-2427-postgres-bus (pre-commit) | n/a | FAIL (expected) | `GOAL_CONTROL=no-listen`: `1:reply` and `1:run` never arrived within 3 s (also `3`, `4`, since the patch says "crosses" everywhere) |
| 2026-11-03 | fix/FIX-2427-postgres-bus (pre-commit) | n/a | FAIL (expected) | `GOAL_CONTROL=trust-listen`: `3:drop` never arrived within 10 s, nor `3:back` |
| 2026-11-03 | fix/FIX-2427-postgres-bus (pre-commit) | n/a | FAIL (expected) | `GOAL_CONTROL=no-bus` (today's `main`): `2:idle` 80 statements in 10 s for two views |
