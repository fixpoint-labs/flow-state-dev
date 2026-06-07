---
---

Internal-only refactor of the private `@flow-state-dev/trading-desk` example.
Splits the portfolio domain (accounts, quotes, PDF import) into a standalone
`portfolio` flow (`src/flows/portfolio/`) and renames the original
`trading-desk` flow to `analysis` (`src/flows/analysis/`). Resources that were
user-scoped with `flowIsolation: true` are flipped to shared (`flowIsolation:
false`, bare `{userId}`) so the analysis flow can read the portfolio data
server-side at `seedSession` without a client bridge. The `analyze` action no
longer takes a `portfolio` dispatch input. Package name, app name, and all
component / capability names stay "trading-desk" — only the flows are renamed
to purpose names.
