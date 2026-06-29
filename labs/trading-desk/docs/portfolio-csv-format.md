# Portfolio CSV import format

The Portfolio view imports holdings from a CSV you paste or upload, into one
account you choose. The parser is tolerant of real brokerage exports, but a
canonical format imports with zero column mapping.

## Canonical format

A header row (case-insensitive, order-independent) plus one row per holding:

```
ticker,quantity,costBasis,acquiredDate
NVDA,12.5,118.40,2024-03-15
AAPL,40,176.10,2023-11-02
```

- `ticker` — required. Trimmed, upper-cased, must match `[A-Z0-9.\-]{1,12}`
  (so `BRK.B` is fine). A bad ticker is reported as a row error, not imported.
- `quantity` — required. Fractional shares are allowed (`0.4213`). `$` signs and
  thousands separators are stripped. A zero or unparseable quantity is a row
  error.
- `costBasis` — optional. Average cost per share. Blank means "unknown" and is
  stored as null (the UI shows `—`, not `0`). An unparseable non-empty value is
  a row error.
- `acquiredDate` — optional. ISO `YYYY-MM-DD`. An unparseable date is a warning,
  not a rejection: the holding still imports with a blank date.
- `assetType` — optional. One of `equity / etf / mutual_fund / bond /
  money_market / crypto / option / other`. Provides a per-row classification hint.
  Absent or unrecognized values are inferred server-side from the symbol shape
  (CUSIP → bond, OCC option format → option, crypto pair → crypto, etc.). Most
  equity tickers don't need this column at all.

## Tolerant column mapping

Headers are normalized (lower-cased, non-alphanumerics removed) and matched
against a synonym table. The first synonym that appears wins:

| Canonical field | Accepted headers |
| --------------- | ---------------- |
| `ticker` | ticker, symbol, sym, security, securityid |
| `quantity` | quantity, qty, shares, sharesheld, units |
| `costBasis` | costbasis, avgcost, averagecost, costpershare, unitcost, purchaseprice, **price** |
| `acquiredDate` | acquireddate, dateacquired, purchasedate, opendate, date |
| `assetType` | assettype, type, assetclass |

So a Fidelity/Schwab export with `Symbol, Shares Held, Avg Cost` maps with no
edits. The dialog shows the resolved mapping ("Detected columns") before you
import.

### The `price` ambiguity

`price` is the LAST synonym for `costBasis` on purpose: many exports use `price`
for the *current* price, not your cost. An explicit `costBasis` / `avgCost`
column always wins. If only a bare `price` column exists, it maps to cost basis
**and the import emits a warning** so you can verify it. Cost basis is never
silently guessed.

## Duplicate rows

If the same ticker appears on multiple rows (common when a broker exports one
row per lot), the rows are merged into one holding with a **quantity-weighted
average cost**, and a warning records how many rows were collapsed. This is the
average-cost model: it is informational, not tax basis (it does not preserve
lots, holding periods, or wash-sale adjustments).

## Merge modes

- **Upsert** (default, non-destructive): each imported ticker replaces that
  ticker's holding in the account. Tickers already in the account but not in the
  CSV are left untouched.
- **Replace account** (destructive): every existing holding in the account is
  deleted first, then the CSV rows are imported. Use this when the CSV is a full
  snapshot. It requires typing `REPLACE` to confirm. It is **not atomic** — a
  crash mid-import can leave a partially imported account (there is no
  transaction or rollback on the development filesystem store).

## Cash

The row format does not carry cash. Set an account's cash balance with the
optional "Cash balance" field in the import dialog (or when adding the account).

## Limitations

- Quoting: simple double-quoted fields (a quoted field may contain commas) are
  handled; full RFC 4180 escaping (`""` inside a quoted field) is not.
- Money math uses JS floats — totals, weights, and P/L are display
  approximations, not precise accounting.
- Single currency per account; no FX. A non-USD cost basis on a foreign ADR is
  not modeled.
- Persistence is the development filesystem store (`developmentOnly: true`) — it
  does not survive an ephemeral/serverless redeploy. This is a demo, not a place
  to keep a real portfolio.
- **Classification is always re-derived server-side.** The `assetType` column is
  a hint; the server never trusts the client's classification verbatim. It runs
  `classify-instrument` and can override a supplied value.
- **Non-equity rows import as typed holdings, not errors.** A bond CUSIP or a
  crypto pair (e.g. `BTC-USD`) classifies as `bond` or `crypto` and is stored
  with its attributes rather than being dropped. Analysis (the research pipeline)
  currently runs on equities only — submitting a bond or crypto symbol to analyze
  stops with an "unsupported-asset-type" result. Bond/option rows imported without
  a statement mark show `—` for value (the PDF import path carries the mark via the
  `markPrice` column). Cash and money-market holdings value at par ($1.00/share),
  so a quantity-1 cash row with no cost basis still shows a value.
