---
---

Trading Desk: a household portfolio-health view (FIX-762). A new Portfolio →
**Health** perspective answers "how balanced is my book?" across every account:
the same name held in three accounts shown as one exposure, asset-class and
sector breakdowns (funds appear as their own bucket — no ETF look-through in this
version), concentration reads (largest single name, top-5 / top-10 weight, and an
"effective number of positions" figure) with plain warn/alert flags, cash level,
and a coverage line for anything that can't be priced. Every figure is plain
arithmetic over stored quantities and sourced prices — no model calls — computed
by a shared pure leaf (`portfolio-health.ts`) that reuses the existing per-type
valuation rule, so the pane and the analysis context show the exact same numbers.
The one axis with no on-holding data — sector — is backed by a new global,
lazily-filled per-ticker classification cache (`app.instrument_classifications`,
filled from the existing Yahoo sector resolver; provider misses are never cached,
so a transient outage can't permanently blank a ticker). The same aggregates are
injected as a compact block into the trader / portfolio-manager analysis context,
so the desk's sizing and concentration commentary reference the real household
picture rather than a raw position list, and the long-dead `holdings[].sector`
field gets its first producer. Drift-versus-target and standing-constraint
compliance land once a durable portfolio mandate exists (FIX-761).

Internal lab change — no public API.
