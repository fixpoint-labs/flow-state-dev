---
---

Trading Desk: the portfolio in the private `@flow-state-dev/trading-desk` example
is no longer equities-only. Every holding now carries an asset class and
instrument type (equity, ETF, mutual fund, bond, money-market/cash, crypto,
option) plus per-type attributes, so a brokerage statement that is mostly bonds
and money-market funds imports as a complete, typed book instead of a small
equity sliver — the importer classifies and preserves those rows rather than
dropping CUSIP-identified bonds and cash. Holdings are valued by type: equities,
ETFs, and crypto via live quotes, cash and money-market funds at par, bonds and
options at their carried statement mark, with anything unpriced shown as "—".
Portfolio NAV now includes the bond and money-market mass, and the holdings table
shows an asset-type chip. Analysis stays equity-only behind an explicit gate: a
non-equity symbol sent to the desk stops cleanly with an "unsupported asset type"
message instead of producing a hallucinated stock report. Internal-only — no
publishable package surface changes.
