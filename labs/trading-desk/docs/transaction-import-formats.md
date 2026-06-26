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

## Aggregate → canonical event mapping

Every event is normalized to the canonical `LedgerEventInput` (signs by TYPE,
magnitudes from the file; `externalId` = the `FITID`):

| OFX aggregate | Canonical `type` | quantity | amount | Notes |
| -- | -- | -- | -- | -- |
| `BUYSTOCK` / `BUYMF` / `BUYOPT` / `BUYDEBT` / `BUYOTHER` | `buy` | `+UNITS` | `−|TOTAL|` | `unitPrice` from `UNITPRICE`; `fee` = `COMMISSION`+`FEES` |
| `SELLSTOCK` / `SELLMF` / `SELLOPT` / `SELLDEBT` / `SELLOTHER` | `sell` | `−|UNITS|` | `+|TOTAL|` | |
| `INCOME` (`INCOMETYPE` DIV/CGLONG/CGSHORT) | `dividend` | null | `+|TOTAL|` | |
| `INCOME` (`INCOMETYPE` INTEREST) | `interest` | null | `+|TOTAL|` | |
| `REINVEST` | `dividend` + `buy` | — / `+UNITS` | `+|TOTAL|` / `−|TOTAL|` | two events; the buy is a new lot; ids `FITID:div` + `FITID` |
| `TRANSFER` / `JRNLSEC` | `transfer` | `±UNITS` (by `TFERACTION`) | `0` | a transfer-IN sets `basisUnknown` (no price in file) |
| `INVBANKTRAN` (`STMTTRN`) | `deposit` / `withdrawal` / `interest` / `dividend` / `fee` | null | signed `TRNAMT` | by `TRNTYPE`, sign preserved |
| `MARGININTEREST` / `INVEXPENSE` | `fee` | null | `−|TOTAL|` | |
| `SPLIT` / `RETOFCAP` / `CLOSUREOPT` | — (skipped) | — | — | surfaced in `skipped`; v1 does not adjust basis for corporate actions |
| anything else | — (skipped) | — | — | surfaced as a warning, never silently dropped |

Dates: an OFX `YYYYMMDD[HHMMSS...]` is truncated to `YYYY-MM-DD`. Currency comes
from the statement's `CURDEF` (default `USD`).

Two known limitations of the OFX shape:

- **Intraday ordering across aggregate types is not preserved.** `ofx-js`
  collapses sibling tags into a keyed object, so the parser emits events grouped
  by aggregate kind, not in document order. FIFO basis is still deterministic —
  `deriveLots` re-orders same-day events as acquisitions-before-disposals and
  consumes oldest-first — so the open-lot result is stable; only the rare case of
  two same-day, same-ticker acquisitions of *different* kinds (a buy and a DRIP
  reinvest) could pick a different lot for a same-day sell.
- **One file, one target account.** A consolidated export with several
  `INVSTMTRS` blocks (multiple accounts) imports every transaction into the one
  account the user selected; the parser warns when it sees more than one. Import
  a per-account file to keep histories (and basis) separate.

## Security resolution (CUSIP → ticker)

`resolveTicker` looks up the transaction's `SECID.UNIQUEID` in the `SECLIST` map.
If the `SECINFO` has a `TICKER`, that wins. Otherwise the CUSIP itself is used as
the event's ticker AND the security is added to `unresolvedSecurities` for manual
mapping. This keeps a CUSIP-only export (e.g. Fidelity) honest: the events land,
keyed by CUSIP, and the report says which need a ticker. The consequence: a
CUSIP-keyed event won't fingerprint-match a ticker-keyed event from another feed,
and won't attach to a ticker-keyed holding, until mapped.

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
  quantity: 10, unitPrice: 150, amount: -1504.95, fee: 4.95,
  externalId: "A1", currency: "USD", basisUnknown: null,
}
```

## Broker transaction CSV (follow-up)

Per-broker transaction CSVs (Fidelity, Schwab, Vanguard, …) have no common
layout. The planned shape is a registry of per-broker adapters keyed off a
header signature — `{ match, columns, vocab, signRule }` — each emitting the same
`LedgerEventInput`, wired into the `else` branch of `transaction-file.ts`. Until
then a non-OFX file reports a clear "only OFX-family files are supported" parse
error.
