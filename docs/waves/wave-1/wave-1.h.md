# Wave 1.h - Registry and HTTP Routing (Canonical Wave H)

## 1. Objective

Implement canonical server flow registry and catch-all HTTP routing for `/api/flows/[...path]`, including route parsing, endpoint handlers, and server package export wiring.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave H: H1-H5)
2. `../preperation/architecture/SERVER_AND_CLIENT.md` (registry and route contracts)
3. `../preperation/architecture/FLOW_SYSTEM.md` (canonical route surface)
4. `../preperation/architecture/STREAMING.md` (request stream replay semantics)
5. `docs/waves/wave-1/wave-1.g.md` (execution/runtime handoff assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- flow registry implementation (`register/get/list`)
- catch-all path parser for canonical `/api/flows` endpoints
- route handlers for flow list/capabilities/action execution/request stream/session APIs
- catch-all router adapter (`GET/POST/DELETE`) with internal no-op request bootstrap seam points
- server root export wiring for registry/routes
- unit coverage for registry/parser/handlers/router integration
- wave artifacts and root changelog update

### Out of scope

- client package transport/hook integration (Wave I)
- long-lived user-stream runtime enablement (Phase 2 capability)
- advanced auth/rate-limiting middleware (Phase 2)
- filesystem auto-discovery of flow modules (deferred)

## 4. Task Plan

### W1H-T1: Implement flow registry (H1)

Files:

- `packages/server/src/registry/flow-registry.ts`

Acceptance criteria:

- `FlowRegistry` contract supports `register`, `registerMany`, `get`, `list`
- duplicate `(kind,id)` registration is rejected
- deterministic registry list/get behavior is test-covered

### W1H-T2: Implement route parser and handlers (H3)

Files:

- `packages/server/src/routes/parseFlowRoute.ts`
- `packages/server/src/routes/http-handlers.ts`

Acceptance criteria:

- parser maps canonical endpoints for flows/capabilities/actions/streams/sessions
- action routes enforce `userId` requirement at HTTP boundary
- request stream handler parses `Last-Event-ID` and `starting_after`
- session state snapshot endpoint is available at `GET /api/flows/sessions/:sessionId/state`
- capability endpoint is available at `GET /api/flows/capabilities`

### W1H-T3: Implement catch-all router adapter (H4)

Files:

- `packages/server/src/routes/createFlowApiRouter.ts`
- `packages/server/src/routes/index.ts`

Acceptance criteria:

- adapter returns `GET/POST/DELETE` handlers for catch-all routes
- request bootstrap includes internal no-op context seam hooks for future middleware
- routing delegates to parser + handlers consistently

### W1H-T4: Wire server root exports and tests (H5)

Files:

- `packages/server/src/index.ts`
- `packages/server/test/registry-routes.test.ts`
- `packages/server/test/index.test.ts`
- `docs/waves/wave-1/wave-1.h-journal.md`
- `docs/waves/wave-1/wave-1.h-changelog.md`
- `changelog.md`

Acceptance criteria:

- registry/routes are exported from `@flow-state-dev/server`
- wave test coverage verifies parser/handler/router paths
- wave artifacts and root changelog are updated

## 5. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Flow registry | `packages/server/src/registry/*` | `pnpm --filter @flow-state-dev/server test` | registry tests pass |
| Route parser + handlers | `packages/server/src/routes/parseFlowRoute.ts`, `packages/server/src/routes/http-handlers.ts` | `pnpm --filter @flow-state-dev/server test` | parser and canonical endpoint tests pass |
| Catch-all router adapter | `packages/server/src/routes/createFlowApiRouter.ts` | `pnpm --filter @flow-state-dev/server test` | GET/POST/DELETE route integration tests pass |
| Server export wiring | `packages/server/src/index.ts`, `packages/server/test/index.test.ts` | `pnpm --filter @flow-state-dev/server test` | export smoke checks pass |
| Wave artifacts | `docs/waves/wave-1/wave-1.h-journal.md`, `docs/waves/wave-1/wave-1.h-changelog.md`, `changelog.md` | n/a | artifacts present and aligned |

## 6. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/server typecheck` passes
- [x] `pnpm --filter @flow-state-dev/server test` passes
- [x] `pnpm -r --if-present typecheck` passes
- [x] `pnpm -r --if-present test` passes
- [x] contract spot-check completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave H
  - `../preperation/architecture/SERVER_AND_CLIENT.md`
  - `../preperation/architecture/FLOW_SYSTEM.md`
  - `../preperation/architecture/STREAMING.md`
- [x] `docs/waves/wave-1/wave-1.h-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.h-journal.md` updated
- [x] `changelog.md` updated with Wave 1.h summary

## 7. Definition Of Done

Wave 1.h is done when:

- server has a canonical flow registry
- catch-all route parsing and endpoint handling are implemented for canonical `/api/flows` routes
- request action routes enforce `userId` at boundary and invoke runtime execution
- request stream routes support replay cursor parsing (`Last-Event-ID` and `starting_after`)
- server package exports registry/routing surfaces for downstream client/react/cli integration

## 8. Handoff To Wave 1.i

Wave 1.i may assume:

- canonical `/api/flows` endpoints are parseable and handler-backed
- request stream and session snapshot endpoints exist for client integration
- flow registry and canonical route surfaces exist for server bootstrap and tooling
