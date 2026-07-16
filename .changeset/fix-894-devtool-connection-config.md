---
"@flow-state-dev/engine": minor
"@flow-state-dev/node": minor
"@flow-state-dev/cli": minor
"@flow-state-dev/devtool": minor
---

Add DevTool connection config: declare `devtool: { userId, bearerToken }` on `createFlowState` in your `fsdev.config.ts`, and `fsdev dev` wires DevTool to it — using `userId` as the session identity and sending `bearerToken` as `Authorization: Bearer` on every flow request. This lets you drive a bearer-gated flow (e.g. knowledge-hub with `KH_MCP_SECRET`) through DevTool without hand-editing settings, using the flow's real authentication (no auth bypass). The token is injected only into the loopback page `fsdev dev` serves; the production `serve`/deploy paths ignore it. The Settings sheet also exposes a bearer-token field for one-off use.
