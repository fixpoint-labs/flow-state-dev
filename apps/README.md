# apps/

Full applications we maintain, test against, and treat as reference implementations. Anything in here is fair game for integration testing and feature rollouts — it runs the latest patterns and exercises the framework end-to-end.

For minimal, focused, copy-paste-able demos see [`examples/`](../examples/).

| Directory | Purpose |
|-----------|---------|
| `devtool/` | First-party inspector app (builds into `@flow-state-dev/devtool`) |
| `docs/` | Documentation site (Docusaurus) |
| `kitchen-sink/` | Reference app hosting one or more flows (currently `chat-agent`); integrates every subsystem — DevTool, skills, thinking style, advisor, patterns |

## apps vs. examples

- **apps/** — full reference applications. Multiple flows OK. Production-adjacent UI. Internal state can be as complex as needed.
- **examples/** — minimal, pedagogical. Each should fit in a single README section. One flow, one concept.

If you're sprinkling in features, checking regressions, or dogfooding a new subsystem — put it here. If you're writing a tutorial-sized snippet, put it under `examples/`.
