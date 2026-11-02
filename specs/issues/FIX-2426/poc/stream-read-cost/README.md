# POC · what an open session-stream view costs the store

Retained design evidence for FIX-2426, not production code. Throwaway.

**Question.** Epic FIX-2367 D1 rejected widening `GET /sessions/:id/stream` to user and org
scopes on the claim that each open view costs "at least four reads a second", and asked this
issue to measure it and set the flip threshold. D6's wake rests on the same number.

**Run** (from the repository root, after `pnpm install`):

```bash
bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh
FIX2426_VIEWERS=1,10,50,100 bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh
FIX2426_CONTROL=no-viewers bash specs/issues/FIX-2426/poc/stream-read-cost/run.sh   # must print 0
```

**What it does.** The real engine router over the real Postgres stores on PGlite, with every SQL
statement counted at the executor. One session holding 200 finished requests; N viewers hold the
stream open for a 10 s window at the shipped one-second interval. `idle`: nothing runs.
`active`: one request in progress and two background runs open (asserted from the stream's own
`session.runs` frame).

**Result, 2026-11-01** (`main` at 824ce87):

| Shape | Viewers | Statements / viewer / s |
|---|---|---|
| idle | 1 · 10 · 50 · 100 | 4.00 at every count |
| active | 1 · 10 · 50 · 100 | 5.6 – 6.9 |

The control reports 0. One of three full-grid runs failed one case on the runs-frame assertion
(not the counts); two reruns passed. The statement count is exact. Time inside the database is
not measured: PGlite runs every query behind one lock, so a timer around `query()` counts other
viewers' waits, and says nothing about a connection pool.
