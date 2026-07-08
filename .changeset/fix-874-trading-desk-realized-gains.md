---
---

Trading Desk: realized capital gains & a current-year tax-impact estimate
(FIX-874). The FIFO lot engine now emits a per-disposal `disposals` array
(short/long classified, honest about unknown basis/holding-period/currency),
persisted to `app.realized_gains` and materialized on the same ledger ingest/void
seam as positions — so realized gains stay live and retract on a void, under a
per-account advisory lock. Adds a year-dimensioned income read
(`getIncomeSummaryByYear`), a lightweight user tax profile (`app.tax_profiles`),
and a deterministic upper-bound federal estimate (`tax-estimate.ts`): the user's
own marginal + long-term rates applied per bucket, with ST/LT netting, the
$3k/$1.5k-MFS loss cap, and a taxable-account/USD filter — a labeled planning
estimate, not tax advice. Surfaces a per-account Realized Gains tab and a
household tax-estimate card + profile dialog, behind a composite
`GET /api/portfolio/tax` and a `PUT /api/portfolio/tax-profile`. An OFX sell with
no proceeds is flagged `proceedsUnknown` (fingerprint-safe) so it's excluded
rather than fabricating a loss. Internal lab change — no public API.
