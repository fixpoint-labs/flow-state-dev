# Realized gains & tax estimate (FIX-874)

The desk records the realized side of your book — every sale's gain or loss,
split into the short-term vs long-term buckets that drive the tax rate — and
turns your tax profile into a rough current-year estimate. It is a **planning
estimate, not filing-grade tax advice**, and it stays current as transactions
import or sync.

This doc is the methodology reference. The user-facing surface is the per-account
**Realized Gains** tab and the household **tax-estimate card**; the code lives in
`src/flows/portfolio/` (pure leaves) + `src/db/repository.ts` (persistence) +
`app/api/portfolio/tax*` (REST).

## Realized gains

Realized gains are derived by the same FIFO lot engine that derives positions
(`deriveLots` in `lots.ts`), and **materialized on the same ledger ingest/void
seam** (`materializeRealizedGains` mirrors `materializePositions`): a full
recompute per account, so a void retracts the gain and a re-import is idempotent.
One row per **(disposal event × consumed lot)** lands in `app.realized_gains`,
matching Form 8949's per-lot granularity — a single sale can be part short, part
long.

- **Short vs long** is the IRS calendar rule (`holding-period.ts`): long-term is
  held **more than** one year; the anniversary day itself is still short. Trade
  date on both ends, calendar arithmetic (not a 365-day count).
- **Sell-only realization.** A realized record is emitted only for a `sell`. A
  `transfer`-out moves shares but is not a taxable disposition — it consumes lots
  without producing a gain.
- **Honest basis, never zero-filled.** The derivation tracks two independent
  provenance axes:
  - *acquisition date known?* — drives `acquiredDate` / `term`. A transfer-in's
    date is when it arrived, not the original acquisition, so a sold transfer-in
    is `term: "unknown"` **even when its cost basis is known** (its real gain
    still shows on the tab; it's just excluded from the ST/LT tax buckets).
  - *amount realized known?* — drives `costBasis` / `gain`. A no-price buy sold
    has a real term but a null gain; a proceeds-unknown import placeholder
    (`proceedsUnknown` marker) has null proceeds and gain.
  - An **over-sell** (a sale with no matching lot — partial import history) emits
    an unmatched row with real proceeds and unknown acquisition, surfaced rather
    than dropped.
  - A **currency-mismatched** sale (a USD sell consuming a EUR-acquired lot) nulls
    both cost basis and gain — never a `USD − EUR` mixed number.

A disposal contributes to the ST/LT tax buckets **only when `gain !== null` AND
`term !== "unknown"`**. Everything else is surfaced honestly (as excluded
proceeds in the estimate), never zeroed. A proceeds-unknown placeholder among the
excluded disposals is **counted, not summed** — its null proceeds never fold into
the excluded-proceeds dollar figure as `$0`, and the estimate's caveat qualifies
(or omits) the amount so a no-proceeds sale never reads as "≈ $0 excluded".

> **Two proceeds-unknown caveats — the marker is import-time, so it only
> protects rows imported by this release onward:**
>
> 1. **Legacy no-proceeds sells.** An OFX sell missing both `TOTAL` and
>    `UNITPRICE` imported *before* this release was stored as `amount: 0` with no
>    marker — byte-identical to a genuine $0 sale. The backfill therefore derives
>    it as a real $0-proceeds disposal (a full capital loss). It can't be
>    reclassified after the fact: any "amount 0 → unknown" heuristic would also
>    wrongly null genuine $0 sales.
> 2. **Correcting a placeholder needs a void, not a re-import.** A corrected OFX
>    row carries the same `(account, source, externalId)` as its placeholder and
>    dedups away (`ON CONFLICT DO NOTHING`), so re-importing the fixed file does
>    not lift the exclusion. Void the placeholder and record the corrected
>    disposal. A void-and-reimport correction path is a tracked follow-up.

## Income by year

`getIncomeSummaryByYear` is the year-dimensioned parallel to the all-time
`getIncomeSummary` (which is untouched). Dividends and interest are summed per
`(account, ticker, year, currency)` from the ledger at read time, attributed by
trade-date year.

## The estimate

The estimate is a deliberate **upper bound** (the industry-standard posture for a
planning preview): you supply your own marginal rates and they apply directly to
each bucket — no bracket-table walking or income stacking. The tax profile
(`app.tax_profiles`) carries:

- **Filing status** (single / mfj / hoh / mfs) — sets only the loss-deduction cap.
- **Marginal ordinary rate** (%) — applied to short-term gains + interest.
- **Long-term capital-gains rate** (%) — applied to long-term gains + dividends.
- **State rate** (%, optional) — a flat rate on the full taxable bucket.

What the estimate still models faithfully (these materially change the number):

1. **ST/LT netting with Schedule-D cross-net.** Net short vs short, long vs long,
   then cross-net; a loss in one character absorbs into a gain in the other,
   keeping the surviving character.
2. **The $3,000 ($1,500 MFS) capital-loss cap.** A net capital loss reduces
   ordinary income up to the cap; the remainder is a display-only carryforward
   (not applied to future years here). A loss never offsets qualified dividends,
   and the estimate is never negative.
3. **Per-bucket income floors.** Interest and dividends are floored at 0
   separately before joining their bucket, so a same-year income reversal can't
   silently erase a differently-charactered capital gain.

`ordinaryTaxable = max(0, max(0, net ST gain) + max(0, interest) − deductible loss)`;
`ltcgTaxable = max(0, net LT gain) + max(0, dividends)`. Federal =
`ordinaryTaxable × ordinaryRate + ltcgTaxable × ltcgRate`; state =
`(ordinaryTaxable + ltcgTaxable) × stateRate`.

Only **taxable accounts** (not IRA/Roth/401k) and only **USD** rows (by the
row's own currency, so a EUR row in a default-USD account is excluded) feed the
estimate, for the requested year. Excluded disposals are surfaced as
`basisUnknownProceeds` / `basisUnknownCount`.

### Worked example

Buy 10 AAPL @ $100 on 2024-01-01 (a long lot). Buy 10 @ $200 on 2026-02-01 (a
short lot). Sell 15 on 2026-06-01 for $4,500 total. FIFO consumes the long lot
fully then 5 of the short lot, so realized gains materialize as:

| Ticker | Term  | Qty | Proceeds | Cost basis | Gain   |
| ------ | ----- | --- | -------- | ---------- | ------ |
| AAPL   | long  | 10  | $3,000   | $1,000     | $2,000 |
| AAPL   | short | 5   | $1,500   | $1,000     | $500   |

With a profile of 24% ordinary / 15% LTCG, no state: ordinary bucket = $500 →
$120; LTCG bucket = $2,000 → $300; estimated total ≈ **$420** (plus whatever
dividends the year carried at the LTCG rate).

## What it deliberately doesn't do

Wash sales · specific-lot / LIFO / HIFO selection (FIFO only) · corporate-action /
return-of-capital basis · NIIT · per-position qualified-vs-ordinary dividend
classification (all dividends are assumed qualified) · full layer-by-layer
bracket stacking (the upper-bound simplification) · state-specific brackets (flat
rate only) · loss carryforward into future years · multi-currency · non-equity
tax treatment. Each is disclaimed in the estimate's assumptions.

See also [`transaction-import-formats.md`](transaction-import-formats.md) for how
the ledger events the realized side reads are imported.
