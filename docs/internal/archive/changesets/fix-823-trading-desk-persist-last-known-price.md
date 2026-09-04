---
---

Trading Desk: the private `@flow-state-dev/trading-desk` example now persists a
durable last-known price per instrument, so a portfolio can be valued without a
live quote fan-out on every read. The ephemeral, per-user quotes cache (an FSD
resource, forgotten when the session ended and not joinable to holdings) is
replaced by a ticker-keyed `app.quotes` table on the relational model layer —
one global row per ticker with the last price we saw, its market as-of, its
source, and when we cached it. A price refresh upserts live, non-null prices into
that table; fixture-mode results and provider misses are deliberately not written,
so demo data or a failed refresh can never overwrite a good last-known price.

Consumers now value from persisted state: the Portfolio pane reads prices via a
new `GET /api/portfolio/quotes` route (refetching once a refresh completes), and
the analysis seed reads them straight from the table. Market value stays derived
(`quantity × price`), never stored on the holding, so it can't go stale on a trade
when the price didn't move. Each quote-sourced holding now carries its own as-of,
so the UI can label per-holding staleness honestly (one name fresh, another days
old) instead of implying every price is live. Internal lab / private example — no
public API changes.
