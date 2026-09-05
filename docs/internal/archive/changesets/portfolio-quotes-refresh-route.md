---
---

FIX-823 follow-up: Internal-only change to the private `@flow-state-dev/trading-desk` example. Convert the portfolio price refresh from the `getQuotes` flow action to a plain `POST /api/portfolio/quotes/refresh` REST route (mirroring the `backfillSplits` route). The pane now `await`s the write directly and refetches, dropping the `awaitingQuotes` state + the `isStreaming`-settle `useEffect` that worked around `sendAction` resolving before the upsert committed, and dropping the "Live prices need a session" gate — the route needs no bound session. No publishable package surface changes.
