# examples/

Minimal, focused, pedagogical snippets. Each example should fit in a single README section and demonstrate one concept cleanly. If it's more than a page of code, it probably belongs under [`apps/`](../apps/) (framework reference apps) or [`labs/`](../labs/) (real applications built on the framework).

| Directory | Purpose |
|-----------|---------|
| `hello-chat/` | Minimal chat flow — generator + handler + sequencer in ~50 lines. The best starting point. |

The trading desk moved to [`labs/trading-desk`](../labs/trading-desk) once it grew past a single-concept snippet into a real research app.

## apps vs. examples vs. labs

- **apps/** — framework reference applications and infrastructure (the devtool, the docs site, kitchen-sink). Built to exercise or demonstrate the framework itself.
- **examples/** — minimal, pedagogical. One flow, one concept, no production concerns.
- **labs/** — applications built for real-world use: real data, durable state, domain requirements. Past a teaching snippet, not yet a shipped product.
