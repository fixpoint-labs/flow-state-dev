---
---

Trading Desk: import OFX-family transaction files (QFX / QBO / raw OFX) into the
FIX-774 ledger (FIX-775). A pure, browser-safe `portfolio-ofx.ts` parser
normalizes each investment aggregate onto the canonical `LedgerEventInput` —
signs by aggregate TYPE (so a file backfill and a Plaid sync of one trade
fingerprint identically), `SECID`→`SECLIST` ticker resolution with CUSIP-only
surfaced rather than dropped, DRIP split into a dividend + a reinvested buy, and
honest skip-with-warning for anything long-only FIFO can't model (short opens,
option short-side legs, corporate actions, and malformed / dateless / amountless
rows). The `importTransactions` action re-parses server-side and ingests through
the unchanged idempotent contract; the `ImportTransactionsDialog` previews with
the same parser before committing. Internal lab change — no public API.
