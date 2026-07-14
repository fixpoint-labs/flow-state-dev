---
"@flow-state-dev/node": patch
---

Export `assertNetworkBindIsAuthenticated(app, { host })` and `isLoopbackHost(host)` — a reusable loopback-bind safety rail that refuses to expose a network host when a served flow would run on the framework's default (unauthenticated) principal resolver. Custom server entrypoints can share it instead of hand-rolling a per-app check.

`serve()` (and `createServerApp`) now serve a transport adapter's dedicated path when it lives outside `basePath` — for example the MCP adapter's `/mcp/:kind` under `dedicatedBasePath: true`. Requests Hono doesn't otherwise route are offered to the engine's dedicated-route dispatcher, which matches ONLY custom transport routes (never the canonical flow-API handler), so a self-hosted process serves dedicated endpoints with no extra wiring — and the flow API (list-flows, actions, sessions) stays reachable only under `basePath`. This holds in both serve modes: with a `staticDir` (the `fsdev dev` path), the SPA fallback defers to dedicated routes first, so a dedicated GET route isn't shadowed by the DevTool HTML. `createServerApp` exposes `tryDedicatedRoute(req)` for hosts that add their own catch-all after the app.
