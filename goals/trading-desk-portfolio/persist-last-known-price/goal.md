# Goal: value a portfolio from persisted last-known price without a live refresh

**Contract.** A holding stores `quantity` and `costBasis` but no notion of what
it is worth. Before FIX-823 the only price cache was an ephemeral, per-user
`portfolioQuotes` FSD resource — not joinable to holdings, forgotten when the
session ends, and never a durable "what is this position worth, and how stale is
that price" a consumer could read without forcing a live quote fan-out. After
FIX-823 a refresh (`getQuotes`) upserts a durable, ticker-keyed `app.quotes`
table (one global row per ticker: `price`, `as_of`, `source`, `fetched_at`), and
every consumer — the Portfolio pane's read route, the analysis seed — values
`quantity × price` from that persisted state, labeling per-holding staleness
honestly. Value stays DERIVED (never persisted onto the holding, so it can't go
stale on a trade when the price didn't move).

**Real path.** This path has no model — `getQuotes` upserts `app.quotes` through
the FIX-772 repository over embedded PGlite (the real dev DB engine); the read
route and the analysis seed's `buildPortfolioContext` value off the persisted
rows. The check runs the REAL production code — not mocks — by executing, by hand
and outside the default lane, the specs that pin the contract: `portfolio-repository`
(the `upsertQuotes` → `getQuotes` round-trip on the ticker PK, numeric-coerced,
ISO as-of), `portfolio-actions` (the `getQuotes` action persists live non-null
rows only; fixture mode is a no-op; a miss keeps the prior row), `portfolio-quotes-route`
(`GET /api/portfolio/quotes` returns the held tickers' persisted rows), `seed-portfolio-snapshot`
(the seed values NAV from the persisted rows without a second fetch), and
`value-holding` (a quote-sourced price carries the quote's `asOf`).

**Pass criterion.** All five real-path specs pass: a live price persists on the
ticker PK and re-reads as a JS number with an ISO `as_of` WITHOUT a provider call;
the read route and the analysis seed derive a non-trivial NAV from that persisted
state; and per-holding staleness (`asOf`) is threaded for quote-sourced prices
while par / statement / unavailable stay `asOf: null`.

**Anti-game.** Fixture-mode `getQuotes` is intentionally NOT persisted (it would
poison the shared global row), and a null-priced refresh is dropped (a failed
refresh must never null a good last-known price) — so "the table holds a usable
price" can't be faked by demo data or a provider hiccup. Value is never persisted
onto the holding, so "valued without a live fetch" can't be faked by storing a
stale product.

**Model.** none — quote persistence and valuation are deterministic TS over real PGlite; no LLM is in this path.

**Run.** Out of CI, by hand (no model cost):

```
pnpm tsx goals/trading-desk-portfolio/persist-last-known-price/run.mts
```

## Verdict log

- 2026-07-10 — **PASS**. The five real-path specs pass over embedded PGlite: a
  live AAPL quote upserts to `app.quotes` and re-reads as `210.5` with an ISO
  `as_of` without a second fetch; the read route returns only the held tickers'
  persisted rows; the analysis seed values NAV from the persisted rows (10 × 131.4
  + 1000 cash = 2314); fixture-mode `getQuotes` persists nothing and a null-priced
  refresh keeps the prior row; and quote-sourced prices carry the quote's `asOf`
  while par/statement/unavailable are `asOf: null`.

- 2026-07-25 — **PASS** (none). All five real-path specs green over real PGlite. Run during the goals/lib migration (runner scaffolding only; no product code changed).
