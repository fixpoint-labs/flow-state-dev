# session-stream › it wakes on a change

**Issue:** FIX-2426
**Outcome:** A change saved in a session reaches every open view of it as soon as it is saved, and a view of a session where nothing changes costs the database nothing, wherever a bus carries the change. Where none can, views keep the one-second read and miss nothing.
**Input:** Two servers (two routers, each over its own Postgres stores) over one Postgres database (PGlite), as two processes would hold it. Server A answers in session `s1` with a handler that writes only items and a status (a plain reply), and starts a background run through a dispatcher. Server B holds an open view (`GET /sessions/s1/stream`). Legs a and b share one bus that says it crosses processes (`goals/lib/crossing-bus.mts`); leg c gives each server its own in-memory bus. Held-out: any reply text and any run key must pass; nothing in the check keys on them beyond finding the reply.
**Signal:**
- `a:reply` — B's view receives A's reply less than 1000 ms after A saved it (polled off A's store every 5 ms).
- `a:run` — B's view names A's background run in `session.runs` less than 1000 ms after the run's start is saved (a running request under a child of `s1` on A's store).
- `b:no-read-between` — over a 10 s idle window, B's open view makes 0 database statements, counted at B's executor.
- `c:fallback` — with each server on its own in-memory bus, B's view receives A's reply less than 2000 ms after it was saved.

**Anti-game:** Not `publish` calls and not a mocked store: both pass while B's view stays empty. Every assertion reads what B's stream delivered (`session.item`, `session.runs`) or what B asked the database (statements at B's executor), never the bus. One registry is not two servers, so A and B each hold their own stores over the shared database. Each graded list is floored with `tell.over`, so a leg that read nothing is CAN'T TELL.
**Model:** n/a
**Run:** `pnpm tsx goals/session-stream/wakes-on-a-change/run.mts`
**Controls:**
- `GOAL_CONTROL=no-publish` — the write wrapper publishes nothing (a scratch patch to `packages/engine/src/bus/publish-writes.ts`). Must FAIL `a:reply` and `a:run`; `b:no-read-between` and `c:fallback` still pass.
- Today's `main` (the parent of this change) must FAIL `b:no-read-between`: the stream reads 4 statements a second per idle view. Measured by the retained POC (`specs/issues/FIX-2426/poc/stream-read-cost/`) rather than this runner, which uses the bus API that `main` lacks.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-02 | fix/FIX-2426-bus (pre-commit) | n/a | PASS ×4 | b: 0 statements in 10 s idle · a: reply 19–29 ms after saved · a: run 935–957 ms after it started · c: reply 470–485 ms after saved. The run leg sits near its bound by design: the read capped at one an interval takes the run's start at the interval's end |
| 2026-11-02 | fix/FIX-2426-bus (pre-commit) | n/a | FAIL (expected) | `GOAL_CONTROL=no-publish`: `a:reply` and `a:run` never arrived within 3 s; CAN'T TELL lines for both reads |
