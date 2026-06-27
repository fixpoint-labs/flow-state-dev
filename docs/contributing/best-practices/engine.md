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

### BP-031: Key auth and routing decisions off the trusted transport `source`, not caller `metadata`

- Status: Active
- Date: 2026-06-27
- Scope: Request handling — transport, authorization, routing, multi-tenant keys.
- Rule:
  - Decide request kind (event vs public action, webhook vs chat) and authorization from the framework-set transport `source`, never from `body.metadata` or any caller-controllable field — anything the caller can set, the caller can forge.
  - A policy branch that reads a metadata coordinate (e.g. `metadata.webhook`) must gate on the trusted `source` matching it first; mirror `resolveActionCore` rather than inventing a new trust path.
  - Scope dedup / void / attribution keys (e.g. `resumedBy`) to the authenticated identity and the full tenant tuple, never a bare block/action name an unrelated caller could collide with.
