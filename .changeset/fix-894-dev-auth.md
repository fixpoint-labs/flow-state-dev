---
"@flow-state-dev/engine": minor
"@flow-state-dev/cli": minor
---

Add `fsdev dev --dev-auth`, a local-only development mode that trusts the request-body `userId` for HTTP action requests so bearer-gated flows are debuggable in DevTool without a token. Off by default; only HTTP-action traffic is affected (MCP and scheduled transports keep their real per-flow auth); the dev server prints a loud warning at startup and refuses to run when `FSD_DB_URL`/`DATABASE_URL` is set. The engine exposes this as a `devAuth` option on `createFlowApiRouter` (with an `FSDEV_DEV_AUTH=1` env fallback for config-based servers).
