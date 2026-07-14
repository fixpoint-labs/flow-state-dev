---
"@flow-state-dev/cli": patch
---

Add `fsdev serve`, a production server command for the flow API and MCP endpoints with no DevTool UI. It runs from a committed `fsdev.config.*` (no directory discovery), binds `$HOST ?? 0.0.0.0` and `$PORT ?? 3000`, and refuses a network bind when a served flow has no authentication configured (override with `--allow-unauthenticated`, or bind a loopback host). Use `fsdev dev` for local development with the DevTool, `fsdev serve` for production.
