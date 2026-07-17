# Best Practices — Engine & Transport

Situational BPs for the execution runtime, option forwarding, and inbound
transport/request handling. Load this file when working in `@flow-state-dev/engine`
or on transport, routing, or authorization seams.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-026: Bundle forwarded options into a `RuntimeConfig`-shaped struct, never drill

- Status: Active
- Date: 2026-05-29
- Scope: Engine — option forwarding through the execution chain.
- Rule:
  - When a field passes through 3+ layers verbatim (read at most once, never transformed), put it on a bundled struct, not a named parameter on every layer. The server chain uses `RuntimeConfig` (`packages/engine/src/runtime-config.ts`) through `createFlowApiRouter` → `createFlowRouteHandlers` → `createInboundTransportHost` → `runAction`.
  - Adding a forwarded field touches only `RuntimeConfig` plus the public boundary that constructs it. Keep the public boundary flat (the bundling is internal; `runtimeConfig` on `CreateFlowApiRouterOptions` is `@internal`).
  - Before adding a field as a named parameter on an intermediate options type, ask: "Does any layer use this, or just forward it?" Forward-only → `RuntimeConfig`. Transformed mid-chain → named parameter on the transforming layer.
- Why: Bundling forward-only options keeps the public boundary flat while a new field stays a one- to two-file change instead of a five-layer drill.

> Trust-boundary rules for the inbound seam (classify events vs actions off the trusted transport `source`, not `body.metadata`) are now universal **BP-031** — see [`../best-practices.md`](../best-practices.md).

### BP-040: Dev credential injection in served HTML

- Status: Active
- Date: 2026-07-17
- Scope: Engine & transport — loopback dev servers and any code that embeds credentials in HTML (inline script globals, injected config).
- Rule:
  - **Bind:** ignore or strip credential injection when `serve()` (or equivalent) is not on a loopback host — never publish token-bearing HTML on `0.0.0.0` or a network-facing bind.
  - **Cache:** serve transformed, credential-bearing HTML with `Cache-Control: no-store` so browsers and proxies cannot retain secrets.
  - **Symmetric empty handling:** the writer that injects config must apply the same trim/normalize rules as the reader — do not inject whitespace-only or empty fields that shadow defaults without the consumer using them.
  - **No-op path:** normalize an empty optional config block to `undefined` so the static/production handler path stays byte-identical when nothing usable is configured.
- Why: Dev-only HTML injection is a common way to wire local tools to bearer-gated flows; without loopback enforcement, cache policy, and symmetric empty handling, credentials leak to every interface, survive in cache, or fail silently on misconfiguration.
