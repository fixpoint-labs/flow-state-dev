# examples/

Minimal, focused, pedagogical snippets. Each example should fit in a single README section and demonstrate one concept cleanly. If it's more than a page of code, it probably belongs under [`apps/`](../apps/).

For full reference applications (multiple flows, every subsystem integrated) see `apps/` — in particular [`apps/kitchen-sink`](../apps/kitchen-sink).

| Directory | Purpose |
|-----------|---------|
| `hello-chat/` | Minimal chat flow — generator + handler + sequencer in ~50 lines. The best starting point. |

## apps vs. examples

- **apps/** — full reference applications. Multiple flows OK. Production-adjacent UI.
- **examples/** — minimal, pedagogical. One flow, one concept, no production concerns.
