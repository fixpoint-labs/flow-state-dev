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
| [`claude-code-style/`](claude-code-style) | A Claude Code-style app on the workforce package: sessions on the left, the main thread in the center, background tasks on the right. Built from configuration, React UI and small flows only, with an inventory that fails on anything else. Runs on fixtures until its package pieces land. |
| [`design-system/`](design-system) | The light and dark theme Shift Manager loads over FSD's component tokens. Values only, no components; a check keeps its values out of FSD's own packages. |
| [`knowledge-hub/`](knowledge-hub) | Incubation for the Knowledge Hub (FIX-882–884): typed capture into working-memory staging, a cron sweeper/manager that routes staged items into long-term OKF memory, and a personal workforce roster. The capture layer exists — `logActivity` into a user-scoped inbox with a deterministic mailroom pass (883/884 pending). The finished simple-wiki predecessor moved to [`examples/knowledge-base`](../examples/knowledge-base). |
| [`teammates/`](teammates) | A Grok Bot-style app on the workforce package: a list of workers on the left, each with one long conversation, and workers that message each other where you can see it. Built from configuration, React UI and small flows only, with an inventory that fails on anything else. Runs on fixtures until its package pieces land. |

Shift Manager, the app a Workforce team is worked through, is published as
[`@flow-state-dev/shift-manager`](../packages/shift-manager).

Trading Desk now lives at https://github.com/fixpoint-labs/trading-desk.
