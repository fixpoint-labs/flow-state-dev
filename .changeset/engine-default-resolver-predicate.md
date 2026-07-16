---
"@flow-state-dev/engine": patch
---

Export `isDefaultBodyUserIdPrincipalResolver(resolver)` — a package-instance-stable check (via a globally-registered brand) for whether a principal resolver is the framework default that trusts a caller-supplied `body.userId`. Lets tooling detect an unauthenticated flow without relying on function identity, which breaks across duplicate package instances.

Export `dispatchDedicatedRoute(router, req)` — dispatch a request against ONLY a router's dedicated custom-adapter routes (those a transport adapter registers outside the canonical `basePath`, e.g. the MCP adapter's `/mcp/:kind` under `dedicatedBasePath`). Returns the matched route's `Response`, or `null` when none match; it never falls through to the canonical flow-API handler. Lets a long-lived host serve dedicated endpoints without exposing the flow API outside its mount prefix.
