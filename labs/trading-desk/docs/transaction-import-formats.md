# Transaction file import — formats

Reference for the FIX-775 transaction-file importer: the OFX-family grammar, the
aggregate-to-canonical mapping, and how to extend it. The companion to
[`portfolio-csv-format.md`](portfolio-csv-format.md) (which covers the holdings
*snapshot* CSV, a different feed). For the why and the architecture, see the
`## File import (OFX/QFX/QBO)` section in `CLAUDE.md`.

## The OFX family

An OFX file is a `KEY:VALUE` header block, a blank line, then a tagged body.

- **OFX 1.x is SGML.** Aggregate (container) tags are closed; **leaf tags are
  not** — a value reads `<TRNAMT>-42.50` and is terminated by the next tag or a
  newline. A standard XML parser rejects this.
- **OFX 2.x is well-formed XML** — every tag closed, the header in a
  `<?OFX ... ?>` processing instruction.
- **QFX and QBO are Intuit-branded OFX.** Identical transaction body; they add
  proprietary header fields (`INTU.BID`, `FID`, `ORG`) the importer ignores.

`ofx-js` (`parse`) auto-detects the 1.x-SGML vs 2.x-XML branch and returns a
nested object, so the parser does not branch on version. A repeated tag becomes
an array; a single one stays an object — the parser normalizes both with
`asArray`.

Investment transactions live under
`OFX → INVSTMTMSGSRSV1 → INVSTMTTRNRS → INVSTMTRS → INVTRANLIST` (there may be
several `INVSTMTTRNRS`, one per account). Securities are referenced by
`SECID` (`UNIQUEID` = the CUSIP) and described in a separate
`SECLISTMSGSRSV1 → SECLIST` block, whose `SECINFO` carries the name and an
optional `TICKER`.

**Investment statements only.** The importer walks `INVSTMTMSGSRSV1`
(brokerage) statements. A *bank*-format export — a checking/savings QBO or OFX
whose body is `BANKMSGSRSV1 → BANKTRANLIST` (`STMTTRN` cash rows), which is what
a typical QuickBooks `.qbo` download is — carries no investment statement, so it
imports nothing and reports a clear "no investment statement found" warning. This
is a portfolio cost-basis importer, not a bank-transaction importer; a
`BANKTRANLIST` cash path is a possible follow-up, not v1.

## Aggregate → canonical event mapping

Every event is normalized to the canonical `LedgerEventInput` (signs by TYPE,
magnitudes from the file; `externalId` = the `FITID`):

| OFX aggregate | Canonical `type` | quantity | amount | Notes |
| -- | -- | -- | -- | -- |
| `BUYSTOCK` / `BUYMF` / `BUYDEBT` / `BUYOTHER` | `buy` | `+UNITS` | `−|TOTAL|` | `unitPrice` = all-in basis `|amount|/UNITS` (execution price + commission, the cost `deriveLots` reads), NOT raw `UNITPRICE`; `fee` = `COMMISSION`+`FEES` |
| `SELLSTOCK` / `SELLMF` / `SELLDEBT` / `SELLOTHER` | `sell` | `−|UNITS|` | `+|TOTAL|` | |
| `BUYOPT` / `SELLOPT` | — (skipped) | — | — | options aren't modeled in v1; the `SHPERCTRCT` contract multiplier (a ~100× basis error if ignored) and short legs (sell-to-open / buy-to-close) are FIX-773. Surfaced in `skipped` |
| `INCOME` (`INCOMETYPE` DIV/CGLONG/CGSHORT) | `dividend` | null | `+|TOTAL|` | |
| `INCOME` (`INCOMETYPE` INTEREST) | `interest` | null | `+|TOTAL|` | |
| `REINVEST` | `dividend` + `buy` | — / `+UNITS` | `+|TOTAL|` / `−|TOTAL|` | two events; the buy is a new lot; ids `FITID:div` + `FITID` |
| `TRANSFER` | `transfer` | `±UNITS` (by `TFERACTION`) | `0` | a transfer-IN preserves a supplied `UNITPRICE`/`AVGCOSTBASIS`, else sets `basisUnknown` |
| `JRNLSEC` | — (skipped) | — | — | an intra-account subaccount journal has no net position effect; surfaced in `skipped` |
| `INVBANKTRAN` (`STMTTRN`) | `deposit` / `withdrawal` / `interest` / `dividend` / `fee` | null | signed `TRNAMT` | by `TRNTYPE`, sign preserved |
| `MARGININTEREST` / `INVEXPENSE` | `fee` | null | `−|TOTAL|` | |
| `SPLIT` | `split` | null | `0` | **ingested** (FIX-876): ratio from `NUMERATOR`/`DENOMINATOR` (fallback `NEWUNITS`/`OLDUNITS`) on the event's `attributes`; `deriveLots` rebases open lots by it. A `FRACCASH` cash-in-lieu leg becomes a separate cash row + warning. No usable ratio or unresolvable security → skipped-with-warning |
| `RETOFCAP` / `CLOSUREOPT` | — (skipped) | — | — | surfaced in `skipped`; v1 does not adjust basis for these corporate actions |
| anything else | — (skipped) | — | — | surfaced as a warning, never silently dropped |

Dates: an OFX `YYYYMMDD[HHMMSS...]` is truncated to `YYYY-MM-DD`. Currency comes
from the statement's `CURDEF` (default `USD`).

Known limitations of the OFX shape:

- **Intraday ordering across aggregate types is not preserved.** `ofx-js`
  collapses sibling tags into a keyed object, so the parser emits events grouped
  by aggregate kind, not in document order. FIFO basis is still deterministic —
  `deriveLots` re-orders same-day events as acquisitions-before-disposals and
  consumes oldest-first — so the open-lot result is stable; only the rare case of
  two same-day, same-ticker acquisitions of *different* kinds (a buy and a DRIP
  reinvest) could pick a different lot for a same-day sell.
- **One file, one target account.** Import targets a single account. A
  consolidated export with several `INVSTMTRS` blocks (multiple accounts) is
  **refused** (nothing imported, with a warning): merging would mis-attribute one
  account's basis to another, and since OFX `FITID`s are only account-scoped the
  same id across two source accounts would collide on the dedup index and lose a
  row. Export and import one account at a time.
- **Two identical-fingerprint fills in one file collapse to one.** FIX-774's
  content fingerprint keys on `(account, tradeDate, type, ticker, quantity,
  amount)` and its `(account_id, fingerprint)` unique index is unconditional, so
  two genuinely distinct rows that fingerprint identically — e.g. one market
  order filled in two same-price, same-day fills, which a broker emits as two
  aggregates with distinct `FITID`s — dedup to one (counted as `deduplicated`),
  and the position/basis understates. This is the FIX-774 tradeoff that *buys*
  cross-source dedup — a file backfill and a Plaid sync of one trade must collapse
  across different ids — so it is not the file feed's to change; files just make
  it likelier than manual entry because they carry fill-level history. Record a
  distinguishing detail if both fills must land. Surfacing `deduplicated > 0` on a
  first-time import as a warning is a documented follow-up.
- **Files are decoded as UTF-8.** OFX 1.x headers may declare `CHARSET:1252` and
  real bank exports can carry Windows-1252 bytes in `SECNAME` / `MEMO`. The body
  structure is ASCII, so parsing and amounts are unaffected; the damage is
  confined to replacement characters in `description` / security names.
  Re-decoding via the header `CHARSET` is a documented follow-up.

## Security resolution (CUSIP → ticker)

`resolveTicker` looks up the transaction's `SECID.UNIQUEID` in the `SECLIST` map.
If the `SECINFO` has a `TICKER`, that wins. Otherwise the CUSIP itself is used as
the event's ticker AND the security is added to `unresolvedSecurities` for manual
mapping. This keeps a CUSIP-only export (e.g. Fidelity) honest: the events land,
keyed by CUSIP, and the report says which need a ticker. The consequence: a
CUSIP-keyed event won't fingerprint-match a ticker-keyed event from another feed,
and won't attach to a ticker-keyed holding, until mapped.

## Stock splits (FIX-876)

A `SPLIT` aggregate is ingested as a first-class `split` ledger event, not
skipped. The event carries no share delta or cash — its `attributes` hold the
`{ numerator, denominator }` ratio (from `NUMERATOR`/`DENOMINATOR`, falling back
to the holder's `NEWUNITS`/`OLDUNITS`). `deriveLots` applies it by rebasing the
ticker's open lots (`quantity × ratio`, `costPerShare ÷ ratio`) while preserving
each lot's acquisition date, so the holding period is unchanged. Forward and
reverse splits both flow through this one rule. A split sorts **before** same-day
trades (it is effective at the open, so same-day trades are already in post-split
units — applying it after would double-adjust). A `FRACCASH` cash-in-lieu leg is
real money, so it is recorded as a separate cash row and warned, not dropped. A
split with no usable positive-integer ratio, or whose security can't be resolved,
is skipped-with-warning — never a fabricated ratio.

Splits can also be entered by hand (the "Split" type in the add-transaction
dialog) through the same ledger contract. **Cross-source dedup caveat:** the
content fingerprint excludes numerator/denominator, so a manual split and a
re-imported file split on the *same* date dedup to one — but on *different* dates
they double-apply (→ ratio²). Record splits at the broker **ex-date** to line up.

An over-sold position that no split explains (disposals exceed everything ever
held) is never silently deleted: the holding materializes as a flagged
`inconsistent_history` row surfaced in the Portfolio UI with a ⚠ "review" marker.

## Reset-account import mode (FIX-876)

A transaction import runs in one of two modes:

- **Append** (default) — add the file's events, de-duplicating any already
  recorded. Non-destructive.
- **Reset account** — atomically wipe the account's *entire* ledger (manual
  entries included — recorded splits, corrections) and repopulate it from the
  file, then re-materialize positions, all in one transaction (a mid-ingest
  failure rolls the wipe back — no partial-wipe window). Gated behind a typed
  `REPLACE` confirmation. This is the clean escape from a cross-source split
  double-apply: one file becomes the single source of truth. It **destroys manual
  corrections by design** — after a reset, re-record any manual entries (including
  a recorded split); if the file lacks a split the position re-breaks, but now
  *visibly* as an `inconsistent_history` flagged row, not silently.

## Tax-lot CSV (unrealized / realized) — FIX-895

Brokerages also export **tax-lot CSVs**: an *unrealized* file (every currently-open
lot) and a *realized* file (every closed lot, with the exact acquisition it was
matched against). These are NOT holdings snapshots and NOT OFX — they carry
per-lot cost basis and open/close dates. The dispatcher sniffs them after OFX
fails; both feed the same `ingestLedgerEvents` contract.

### Headers

Detection (after OFX misses): `symbol` + `quantity` + `costBasis` + `openDate` +
`unitCost` (all required). Presence of both `closeDate` AND `proceeds` selects
**realized** mode. A `closeDate` without `proceeds` (or vice versa) **rejects the
file** — it's an intended realized export with an unrecognized column, never
parsed as unrealized. Synonyms are matched case- and separator-insensitively:

| Canonical | Synonyms |
| --- | --- |
| `symbol` | `symbol`, `ticker`, `sym` |
| `quantity` | `quantity`, `qty`, `shares`, `units` |
| `costBasis` | `costbasis`, `cost`, `totalcost`, `basis` (the lot **total**) |
| `unitCost` | `unitcost`, `costpershare`, `priceperunit`, `unitprice` |
| `openDate` | `opendate`, `acquireddate`, `dateacquired`, `purchasedate` |
| `closeDate` (realized) | `closedate`, `datesold`, `dateclosed`, `saledate` |
| `proceeds` (realized) | `proceeds`, `totalproceeds`, `salesproceeds` |

`costBasis` is the lot **total** (unlike the Holdings CSV, where it's per-share);
`unitCost` is per-share. A holdings snapshot that reads `costBasis ≈ unitCost` on
its multi-share rows is **refused** with a pointer to the Holdings CSV import —
misreading a per-share basis as a lot total is exactly the corruption this format
avoids.

### Event synthesis

- **Unrealized row → one `buy`**: `quantity = +|qty|`, `amount = −|costBasis|`
  (the lot total is authoritative), `unitPrice = |costBasis| / qty`,
  `tradeDate = openDate`, and a stable `lotKey`.
- **Realized row → a linked `buy` + `sell`**: the buy on `openDate` as above; the
  sell on `closeDate` with `quantity = −|qty|`, `amount = +|proceeds|`, and a
  `closesLotKey` pointing at the buy's `lotKey`.

Missing money is **represented, not dropped**: a blank `costBasis` lands the buy
with `basisUnknown` (position kept, basis honestly unknown); a blank `proceeds`
records the sell with `proceedsUnknown` (disposal + basis + term kept, gain
nulled). Only a missing `symbol` / `qty` / the row's own date, a `qty <= 0`
(shorts out of scope), an OCC option symbol (a Non-Goal), or a currency ≠ the
target account's currency skips the row with a per-row parse error.

### Lot identity and specific-lot disposal

Open positions and realized gains still **derive** from the ledger, but derivation
now honors the lot identity the file carries. A `lotKey` on each buy and a
`closesLotKey` on each realized sell let `deriveLots` consume the *specific* lot
the broker matched — not the FIFO-oldest — so a specific-ID / average-cost / LIFO
file reproduces the broker's exact basis, holding period, and gain. Feeds that
carry no lot identity (OFX, Plaid, manual) still use FIFO, unchanged. A keyed
disposal whose referenced lot isn't open surfaces as an unmatched disposal (real
proceeds, unknown basis/term) — it never silently FIFO-falls-back onto an
unrelated lot. A split never rebases a keyed lot (broker files are already
split-adjusted as of export).

### One source per ticker — use a dedicated account

Within an account, a ticker's share-moving events must all come from **one**
source: all tax-lot-keyed, or all feed-unkeyed, never mixed. The ingest seam
**refuses** a batch that would mix them, in either order (a tax-lot CSV onto
unkeyed OFX history AND an OFX/manual share event onto keyed history both refuse),
with guidance to use a fresh account. So **import tax-lot CSVs into a fresh
account dedicated to them.** A refusal is a normal import report (0 inserts + a
conflicting-ticker warning), rendered in the import dialog. Re-importing the same
file, or importing the paired realized file after the unrealized one, is
same-kind (keyed) and never conflicts — it dedups/coexists. A disjoint realized
file for a *new* tax year appends safely; overlapping / re-cut exports are
re-imported into a fresh account, not appended.

### Fresh-start wipe (one-time rollout prerequisite)

This work made `computeFingerprint` include the lot-identity fields
unconditionally, which is only safe on a **cleared** ledger. Before running the
new code against existing data, wipe the ledger-derived tables once:

- **Dev (embedded PGlite):** `pnpm --filter @flow-state-dev/trading-desk db:clean`
  (deletes `.fsdev/pglite` and regenerates a fresh, migrated database).
- **Deploy (real Postgres):** `pnpm --filter @flow-state-dev/trading-desk
  ledger-reset` — truncates `ledger_events` / `holdings` / `realized_gains` and
  stamps a rollout marker. The deploy migrator **refuses to start** against a
  non-empty legacy ledger without that marker. Snapshot-only holdings (CSV/PDF)
  are re-imported afterward.

### Sample workflow

1. Wipe once (above), or create a **fresh account** for the tax-lot import.
2. Import the **unrealized** file (append) → open positions with per-lot basis.
3. Import each **realized** file (append) → realized disposals whose basis, term,
   and gain match the broker's specific-lot figures. Import *every* tax-year slice.
4. Re-importing any file is a safe no-op (dedup).

## Minimal example

A `BUYSTOCK` and its `SECLIST` entry:

```
<BUYSTOCK><INVBUY>
  <INVTRAN><FITID>A1<DTTRADE>20260105<DTSETTLE>20260107</INVTRAN>
  <SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID>
  <UNITS>10<UNITPRICE>150.00<COMMISSION>4.95<TOTAL>-1504.95
</INVBUY><BUYTYPE>BUY</BUYSTOCK>
...
<SECLIST><STOCKINFO><SECINFO>
  <SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID>
  <SECNAME>APPLE INC<TICKER>AAPL
</SECINFO></STOCKINFO></SECLIST>
```

parses to:

```ts
{
  type: "buy", ticker: "AAPL", tradeDate: "2026-01-05", settleDate: "2026-01-07",
  quantity: 10, unitPrice: 150.495, amount: -1504.95, fee: 4.95,
  externalId: "A1", currency: "USD", basisUnknown: null,
}
```

## Other broker transaction CSVs (follow-up)

The **tax-lot CSV** family above (FIX-895) is the first CSV adapter on this path.
Other per-broker *transaction-history* CSVs (Fidelity/Schwab/Vanguard activity
exports, which list trades rather than lots) still have no common layout. The
planned shape is a registry of per-broker adapters keyed off a header signature —
`{ match, columns, vocab, signRule }` — each emitting the same `LedgerEventInput`,
wired alongside the tax-lot branch in `transaction-file.ts`. Until then a
non-OFX, non-tax-lot file reports a clear "only OFX-family files (.ofx / .qfx /
.qbo) and tax-lot CSVs are supported" parse error.
