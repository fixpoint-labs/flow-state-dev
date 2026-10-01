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
| [`shift-manager/`](shift-manager) | A browser app for looking into any running Lab: point its start command at a Lab's `fsdev.config.mts` and it shows that Lab's teams, workstreams, boards, the asks waiting on you, and each channel's transcript, all read from the Lab while it runs. |
| [`conductor/`](conductor) | A board row run in its own checkout. The package stays in this folder. It is not the shell a Lab is opened through. |
| [`design-system/`](design-system) | The light and dark theme shift-manager loads over FSD's component tokens. Values only, no components; a check keeps its values out of FSD's own packages. |
| [`knowledge-hub/`](knowledge-hub) | Incubation for the Knowledge Hub (FIX-882–884): typed capture into working-memory staging, a cron sweeper/manager that routes staged items into long-term OKF memory, and a personal workforce roster. The capture layer exists — `logActivity` into a user-scoped inbox with a deterministic mailroom pass (883/884 pending). The finished simple-wiki predecessor moved to [`examples/knowledge-base`](../examples/knowledge-base). |

Trading Desk now lives at https://github.com/fixpoint-labs/trading-desk.
