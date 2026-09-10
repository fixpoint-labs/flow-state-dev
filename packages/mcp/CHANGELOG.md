# @flow-state-dev/mcp

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-02 — MCP server adapter (FIX-22)

New package. Mounts as a sibling of the built-in HTTP adapter via `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`; `GET` and `DELETE` return 405. Per-flow `mcp` config and per-action `description` and `mcp.enabled` on `defineFlow`. Tool names derive deterministically from action keys via `decamelize` (`recordPayment` → `record_payment`); collisions and missing descriptions throw at flow registration. Authentication runs through the existing `host.resolvePrincipal` hook. v1 ships stateless-only with single-text-content tool results — no `Mcp-Session-Id`, no `notifications/progress`, no `outputSchema` / `structuredContent`.
