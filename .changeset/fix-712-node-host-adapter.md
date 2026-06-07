---
"@flow-state-dev/node": minor
---

New package: `serve(flowState)` stands up a long-lived Node HTTP server for a self-hosted FSD app — the Node→Web request bridge with unbuffered SSE, a `/healthz` endpoint, optional static asset serving with SPA fallback, and graceful shutdown on `SIGTERM`/`SIGINT`.
