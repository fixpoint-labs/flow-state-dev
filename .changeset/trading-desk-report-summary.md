---
---

Trading Desk: add a per-report **Summary** view to the private
`@flow-state-dev/example-trading-desk` example. An in-report **Theses | Summary**
tab (inside `ThesesPane`) renders an at-a-glance aggregate of a finished report
from already-stored session state — decision header, conviction strip, analyst
TLDR grid, factor + scenario charts, a price overlay with stop/target/fair-value
levels, and risks & dependencies. Zero re-run, zero model spend: every figure
traces to a named stored field, missing metrics surface as gaps rather than
fabricated values, and the not-advice disclaimer stays visible. A finished report
auto-opens on Summary; a streaming run stays on Theses. A new Phase-1 tap
persists a thinned price-history slice (`priceHistory` resource) from the warm
tool cache so the price chart draws without an extra fetch. Charts are inline SVG
/ CSS bars — no chart library added. Portfolio-fit and lens-convergence remain
seams only (later slices). Internal-only — no publishable package surface changes.
