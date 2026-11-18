---
"@flow-state-dev/engine": patch
"@flow-state-dev/node": patch
"@flow-state-dev/next": patch
"@flow-state-dev/vercel": patch
"@flow-state-dev/fsdev": patch
---

FIX-2805: Every host now refuses to serve an app that still trusts `body.userId`, on any `NODE_ENV`, including when it is unset. `serve()` throws before listening on a non-loopback host, and a flow registered after that still gets a 500. Lambda, Next, and Vercel do the same on each request. The 500 body is `Internal server error`; the flow kinds are logged once. A loopback bind (`127.0.0.1`, `localhost`) is unchanged. `allowUnauthenticated: true`, and `fsdev serve` / `fsdev dev --allow-unauthenticated`, is the override.

A network `serve()` initializes stores before the port opens, so `/healthz` is not up during that cold start.

Docs: packages/node/README.md (the quick start `await serve(flowState)` and `await serve(flowState, { pushSecret })` throw on the default host `0.0.0.0` unless every flow has a resolver or the call passes `host: "127.0.0.1"` or `allowUnauthenticated: true`; the network-bind section should say `serve()` runs the check itself, keeps checking after `register()`, and that Lambda, Next, and Vercel return a generic 500 with the kinds only in the log), apps/docs/docs/server/host-adapters.md (`await serve(flowstate, { basePath: "/flows" })` needs a resolver or a loopback host), apps/docs/docs/configuration/client.md (the `serve(flowstate, { basePath: "/flows" })` comment, same), apps/docs/guides/deployment.md (a hand-written `serve()` runs the same guard as `fsdev serve`), apps/docs/guides/realtime.md (`serve(flowstate, { pushSecret })` needs a resolver or `host: "127.0.0.1"`). `apps/docs/docs/workforce/overview.md` already sets `resolvePrincipal`, so that `serve(flowState, { port: 3000 })` sample keeps working.
