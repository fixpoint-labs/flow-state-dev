---
"@flow-state-dev/node": patch
---

Export `assertNetworkBindIsAuthenticated(app, { host })` and `isLoopbackHost(host)` — a reusable loopback-bind safety rail that refuses to expose a network host when a served flow would run on the framework's default (unauthenticated) principal resolver. Custom server entrypoints can share it instead of hand-rolling a per-app check.
