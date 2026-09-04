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
rather than fabricating a loss. The realized-gains materializer chunks its
insert (1,000 rows) so an account with thousands of disposals can't exceed
PGlite's 32,767 (signed 16-bit) per-INSERT parameter ceiling — an unchunked
insert silently desynced the single dev connection, blanking every subsequent
read and write across the app (the ledger insert already chunked for the same
reason). The Realized Gains year/grand totals sum the disposals with a known
gain and note how many basis-unknown rows they excluded ("excludes N (basis
unknown)"), matching the tax card, rather than one unknown-basis disposal
blanking the whole total to "—" (the cross-currency gate still renders "—").
Lifetime net realized gain/loss is now surfaced at a glance too — a "realized"
figure on each account card and a "total realized" figure on the household
summary line — reusing that same grand-total logic (per account in its own
currency, the household in USD; basis-unknown rows noted as "(excl. N)", a
cross-currency set as "—").

On top of FIX-876's split model (a first-class `split` event whose
`{ numerator, denominator }` ratio rebases open lots in `deriveLots`), a
"Backfill splits" action bulk-fixes existing data: it fetches split history from
Yahoo (keyless) for every held ticker and materializes the missing `split`
events through the same ingest contract — so a split dedups by fingerprint
whether it arrived from the backfill, an OFX import, or manual entry — and
realized gains re-derive automatically on the ingest/void seam.
Internal lab change — no public API.
