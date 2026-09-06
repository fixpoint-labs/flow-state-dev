# labs/

Applications built on `@flow-state-dev` for real-world use — not teaching
snippets, not framework reference apps. A lab app pulls live data, persists
durable state, and carries real domain requirements. It is past the
"minimal example" stage but not a shipped product: still research software,
with known gaps documented in its own README.

Where the three top-level app folders sit:

- **[`apps/`](../apps/)** — framework infrastructure and reference apps (the
  devtool, the docs site, kitchen-sink). Built to exercise or demonstrate the
  framework itself.
- **[`examples/`](../examples/)** — minimal, pedagogical. One flow, one concept,
  no production concerns.
- **labs/** (this folder) — real applications. Real data, durable state, domain
  requirements. The hardest, most honest pressure test of the framework.

| Directory | Purpose |
|-----------|---------|
| [`trading-desk/`](trading-desk) | A multi-phase AI research desk for a single stock: parallel analyst fan-out → bull/bear debate → trader proposal → risk debate → portfolio manager rating + portfolio-fit verdict, over live market data and a real imported portfolio. Research only — not financial advice. |
| [`conductor/`](conductor) | Incubation for Conductor (LAB-138): a row on a board becomes a supervised coding run. Something claims it, gives the run its own checkout of the repository, stays with it until it stops, reads the verdict before settling the row, and lets a failed attempt run again in the tree the last one left. One phase (`implement`), one issue at a time, two outcomes. |
| [`knowledge-hub/`](knowledge-hub) | Incubation for the Knowledge Hub (FIX-882–884): typed capture into working-memory staging, a cron sweeper/manager that routes staged items into long-term OKF memory, and a personal workforce roster. The capture layer exists — `logActivity` into a user-scoped inbox with a deterministic mailroom pass (883/884 pending). The finished simple-wiki predecessor moved to [`examples/knowledge-base`](../examples/knowledge-base). |
| [`workforce-poc-c/`](workforce-poc-c) | Never-merge Workforce POC lab C: plan = existing `taskBoard` + resource `readContent` / `writeContent`. No doc store, no second planner. |
