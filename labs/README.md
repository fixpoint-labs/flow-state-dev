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
