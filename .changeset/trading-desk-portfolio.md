---
---

Trading Desk: add a **Portfolio** section to the private
`@flow-state-dev/trading-desk` example. A TopBar nav toggle opens a
Portfolio view with per-account holdings tables (ticker, quantity, average cost,
current price, market value, weight %, unrealized P/L), per-account and total
rollups, an Add Account control, and a CSV import (paste or upload) into a chosen
account with a live mapping/error preview and an authoritative import report.

The portfolio is modeled as two user-scoped, flow-isolated resource collections —
`accounts` and `holdings` keyed `{accountId}__{ticker}` — so the same ticker in
two accounts is two distinct holdings and importing into one account never
clobbers another. CSV parsing is tolerant of real brokerage headers (synonym
mapping), reports bad rows instead of crashing, and merges duplicate lots to a
quantity-weighted average cost. Current prices come from a read-only `getQuotes`
action that reuses the existing price-history fetch path; a missing price shows
`—`, never a fabricated number.

Internal-only — no publishable package surface changes. Money figures are
display approximations, average cost is informational (not tax basis), and
persistence remains the `developmentOnly: true` filesystem store, so a portfolio
does not survive an ephemeral/serverless redeploy.
