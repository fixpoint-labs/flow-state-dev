# Goal: the household health view answers "how balanced is my book?"

**Contract.** The desk reasons one ticker at a time and the portfolio pane is
per-account, so the same name held in three accounts shows as three rows and
nothing answers "how balanced is my portfolio as a whole?". FIX-762 adds a
deterministic household layer: ticker-merged exposure across every account,
asset-class and sector breakdowns (funds as their own opaque bucket — no ETF
look-through), concentration reads (largest single name, top-5/10, effective
positions = 1/HHI) with warn/alert flags, cash level, and honest coverage. The
same compact aggregate is injected into the trader/PM analysis context. Drift
versus a target allocation is the FIX-761-gated follow-up slice (not covered
here).

**Real path.** This path has no model — the household math is deterministic TS
(`summarizePortfolioHealth`) over the app-owned accounts + `app.quotes` +
`app.instrument_classifications` tables (embedded PGlite, the real dev DB
engine), computed by the SAME leaf in the Health pane and at the analysis seed.
The check runs the REAL production code — not mocks — by executing, by hand and
outside the default lane, the specs that pin the contract end to end: the leaf
math + pane reconciliation (`portfolio-health`), the sector cache round-trip
(`instrument-classifications-repository`), the lazy fill route
(`classifications-route`), the compact context projection + `holdings[].sector`
producer (`build-portfolio-context`), the formatter block
(`format-portfolio-context`), and the seed wiring that freezes the health block
onto `state.portfolio` from the read-only sector cache (`seed-portfolio-snapshot`).

**Pass criterion.** All six real-path specs pass: the same ticker in two accounts
merges to one exposure whose value equals the sum; allocation weights (incl. cash)
sum to ~100% of total NAV while exposure weights re-normalize over invested NAV;
concentration flags a 12% single-name equity but exempts a 12% ETF; the leaf's
total NAV reconciles with the pane rollup algorithm on a shared fixture; the
sector cache persists successes only (a miss is retried, never a stored null); and
`seedSession` injects the health block + `holdings[].sector` from the cache
without ever fetching Yahoo.

**Anti-game.** Coverage honesty is pinned: an unpriced holding contributes to no
numerator or denominator and is listed in `unpricedTickers`; an
`inconsistent_history` row changes no total but increments the excluded count. A
provider miss must NOT be cached (the route + repository specs assert the null is
never persisted), so "resolved" can't be faked by poisoning the ticker with a
null sector. The build-context spec pins `health.drift === null` so the deferred
slice can't be silently claimed.

**Model.** none — the household math is deterministic TS over real PGlite; no LLM is in this path.

**Run.** Out of CI, by hand (no model cost):

```
pnpm tsx goals/trading-desk-portfolio/household-health/run.mts
```

## Verdict log

- 2026-07-11 — **PASS**. All six real-path specs green (50 tests over real
  PGlite): the leaf merges the same ticker across two accounts into one exposure
  and reconciles NAV with the pane rollup algorithm on a shared fixture; a 12%
  single-name equity flags while a 12% ETF does not; the sector cache persists
  successes only (a miss is retried, never a stored null); and `seedSession`
  freezes the compact `health` block + `holdings[].sector` onto `state.portfolio`
  from the read-only cache without fetching Yahoo. `health.drift === null` (the
  FIX-761-gated slice is honestly absent). Full trading-desk suite green
  (1192 tests).

- 2026-07-25 — **PASS** (none). All six real-path specs green over real PGlite. Run during the goals/lib migration (runner scaffolding only; no product code changed).
