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

### BP-042: Transport-derived persistence and verification

- Status: Active
- Date: 2026-07-17
- Scope: Engine & transport — inbound adapters, MCP `tools/call`, route handlers, and any seam that derives storage keys before `runAction` validates action input.
- Rule:
  - **Pre-validation writes:** When a transport layer derives a persistence coordinate (session id, resume key) from caller input and passes it to `host.dispatch` / `runAction`, that key can be **written before** the action's Zod/input schema runs. Action-level `.max()`, `.regex()`, etc. bound stored **output** fields, not necessarily the pre-schema session/request row — say so in comments and user docs; bound at the owning transport/engine layer when promoting beyond a lab.
  - **Verify the seam:** Behavior wired in transport adapters (e.g. `mcp.session` → `deriveSessionId`) must have tests at that layer (adapter unit tests plus a real-path transport probe such as MCP HTTP JSON-RPC). `testFlow` and handler-only tests do not exercise the directive — they bypass the adapter.
- Why: False confidence in schema bounds and composition-only tests let transport footguns ship until a manual goal script or production traffic finds them.
