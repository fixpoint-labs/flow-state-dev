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
| [`conductor/`](conductor) | This repository's own host for [`@flow-state-dev/harness-manager`](../packages/harness-manager): a row on a board becomes a supervised coding run. Something claims it, gives the run its own checkout of the repository, stays with it until it stops, reads the verdict before settling the row, and lets a failed attempt run again in the tree the last one left. One phase (`implement`), one issue at a time, two outcomes. A team's coding runs are watched in Shift Manager. |
| [`design-system/`](design-system) | The light and dark theme Shift Manager loads over FSD's component tokens. Values only, no components; a check keeps its values out of FSD's own packages. |
| [`knowledge-hub/`](knowledge-hub) | Incubation for the Knowledge Hub (FIX-882–884): typed capture into working-memory staging, a cron sweeper/manager that routes staged items into long-term OKF memory, and a personal workforce roster. The capture layer exists — `logActivity` into a user-scoped inbox with a deterministic mailroom pass (883/884 pending). The finished simple-wiki predecessor moved to [`examples/knowledge-base`](../examples/knowledge-base). |

Shift Manager, the app a Workforce team is worked through, is published as
[`@flow-state-dev/shift-manager`](../packages/shift-manager).

Trading Desk now lives at https://github.com/fixpoint-labs/trading-desk.
