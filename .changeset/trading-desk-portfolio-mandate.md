---
---

FIX-761: Add a durable, user-editable **portfolio mandate** (Investment Policy Statement) to the private `@flow-state-dev/trading-desk` example. The household records its objectives, a target allocation over the existing asset classes with rebalancing bands, standing constraints (max single-position weight, minimum cash, an exclusion list), and a time horizon; the analysis flow reads it at seed, surfaces it to the portfolio manager, and the PM commit gates position size against the standing constraints deterministically (a hard max-position cap and an exclusion no-add; min-cash and allocation drift are advisory). The per-run risk-appetite mandate (FIX-752) folds in as the mandate's appetite facet — one policy object, not two. No publishable package surface changes.
