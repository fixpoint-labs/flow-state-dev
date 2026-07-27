# transaction-file-import › it reconstructs basis from an OFX file

**Issue:** FIX-775
**Outcome:** A user uploads a brokerage transaction-history file (OFX family: QFX / QBO / raw OFX) and the trades land in the ledger, so cost basis reconstructs from the real buy/sell history instead of a blank or tax-wrong average. A CUSIP-only security is surfaced for mapping, a transfer-in with no price is a visible basis hole, and a corporate action is skipped (not silently mis-counted).
**Input:** The OFX-family files in `fixtures/` (`*.qfx` / `*.qbo` / `*.ofx`), each paired with `<name>.expected.json` stating the ending positions. Held-out: the runner hardcodes no per-file logic, so dropping a **real, anonymized** export from an actual institution beside its own `expected.json` must pass a correct implementation. The shipped fixtures are representative anonymized stand-ins; replace/extend them with real institution exports to validate the one-parser hypothesis against the long tail.
**Signal:** For every fixture: the parse yields ≥1 event; every event validates against the canonical `ledgerEventInputSchema`; the real FIFO `deriveLots` ending positions match the expected `{ticker, quantity, basisUnknown}`; and the `unresolvedCusips` + `skipped` counts match exactly. Prints `PASS` and exits 0 only when all reconcile; otherwise `FAIL` with the diffs and exit 1.
**Anti-game:** The runner must NOT assert on a hardcoded event list — it derives positions through the real pipeline and grades against the fixture's independently-stated ending balances, so a parser that returns canned output for the shipped files would fail the moment a new real file is added. It must NOT skip the schema validation (that's what proves the mapping is ingest-ready), and must NOT treat a zero-event parse as a pass.
**Model:** none — this path has no LLM; the "real" surface is the file format. (The Plaid sibling FIX-853 owns the real-service goal check.)
**Run:** `pnpm tsx goals/transaction-file-import/reconstructs-basis-from-ofx/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-06-26 | f41bbee | none (file path) | PASS | 2 fixtures (QFX 1.x SGML + OFX 2.x XML): AAPL FIFO 11 open after a 4-share sell off the oldest lot; a CUSIP-only buy surfaced unresolved + a SPLIT skipped; MSFT DRIP reinvest → 8.5 open; TSLA transfer-in flagged basis-unknown. All positions, unresolved CUSIPs, and skipped counts reconciled. |
| 2026-07-25 | 5eb5e7e | none | PASS | 2 OFX-family fixtures parsed; every event canonical-valid; FIFO positions, basis-unknown flags, unresolved CUSIPs and skipped actions all reconciled. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
