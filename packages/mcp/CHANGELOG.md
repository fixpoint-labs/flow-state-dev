# @flow-state-dev/mcp

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-02 — MCP server adapter (FIX-22)

New package. Mounts as a sibling of the built-in HTTP adapter via `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`; `GET` and `DELETE` return 405. Per-flow `mcp` config and per-action `description` and `mcp.enabled` on `defineFlow`. Tool names derive deterministically from action keys via `decamelize` (`recordPayment` → `record_payment`); collisions and missing descriptions throw at flow registration. Authentication runs through the existing `host.resolvePrincipal` hook. v1 ships stateless-only with single-text-content tool results — no `Mcp-Session-Id`, no `notifications/progress`, no `outputSchema` / `structuredContent`.
