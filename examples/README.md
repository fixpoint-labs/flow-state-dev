# examples/

Minimal, focused, pedagogical snippets. Each example should fit in a single README section and demonstrate one concept cleanly. If it's more than a page of code, it probably belongs under [`apps/`](../apps/) (framework reference apps) or [`labs/`](../labs/) (real applications built on the framework).

One exception: a lab that finishes its incubation can be preserved here as a **frozen reference app** — complete, working, and no longer changing. It's larger than a snippet, but kept as a self-contained example to read and copy from rather than as active research (see `knowledge-base/`).

| Directory | Purpose |
|-----------|---------|
| `hello-chat/` | Minimal chat flow — generator + handler + sequencer in ~50 lines. The best starting point. |
| `wake-authoring/` | Three authoring shapes for inbound wakes (flow-config, worker-md compile, `wakes:` alias). [FIX-1641](https://linear.app/fixpoint-labs/issue/FIX-1641/poc-wake-authoring-shapes-worker-md-vs-flow-config) POC under FIX-1637. Examples only — not a new product. |
| `knowledge-base/` | A complete personal knowledge wiki: OKF import/export, a concept-CRUD capability, and a secured MCP server. Frozen reference app — grew up in [`labs/`](../labs/), preserved here as a standalone example. Its successor is [`labs/knowledge-hub`](../labs/knowledge-hub). |

Trading Desk now lives at https://github.com/fixpoint-labs/trading-desk. The knowledge base made the reverse trip: it finished incubating in `labs/` and landed here as a frozen reference.

## apps vs. examples vs. labs

- **apps/** — framework reference applications and infrastructure (the devtool, the docs site, kitchen-sink). Built to exercise or demonstrate the framework itself.
- **examples/** — minimal, pedagogical. One flow, one concept, no production concerns.
- **labs/** — applications built for real-world use: real data, durable state, domain requirements. Past a teaching snippet, not yet a shipped product.
