# Wave 1.i - Client and React SDK (Canonical Wave I)

## 1. Objective

Implement canonical `@flow-state-dev/client` transport APIs and `@flow-state-dev/react` wrappers/render helpers for action execution, session/state access, and request-stream consumption.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave I: I1-I4)
2. `../preperation/architecture/SERVER_AND_CLIENT.md` (client/react contracts)
3. `../preperation/architecture/STREAMING.md` (SSE event/resume semantics)
4. `../preperation/architecture/ARCHITECTURE_OVERVIEW.md` (Phase 1 boundaries)
5. `docs/waves/wave-1/wave-1.h.md` (server route/runtime assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- `@flow-state-dev/client` action/session/state/SSE transport modules
- typed flow-bound client surface (`actions.<actionName>(input)`) layered on generic sendAction
- request-stream resume controls (`Last-Event-ID` and `starting_after`) in SSE client
- `@flow-state-dev/react` hook wrappers over `@flow-state-dev/client`
- item rendering helpers (`ItemRenderer`, `ItemsRenderer`, `MessagesRenderer`, `BlockRenderer`)
- block renderer registry and flow context helpers
- package export wiring and unit tests for both packages
- wave docs and root changelog updates

### Out of scope

- user-stream server runtime enablement (still capability-gated/off in Phase 1)
- AI Elements/shadcn visual integration in `apps/devtool` (handled in later UI-focused waves)
- testing package (`@flow-state-dev/testing`) contract implementation (Wave 1.j)

## 4. Task Plan

### W1I-T1: Implement client types and HTTP API surfaces (I1)

Files:

- `packages/client/src/types/index.ts`
- `packages/client/src/internal/http.ts`
- `packages/client/src/action-client/executeAction.ts`
- `packages/client/src/session-client/sessions.ts`
- `packages/client/src/index.ts`

Acceptance criteria:

- action execution client enforces caller-provided `userId` and canonical routes
- session APIs cover list/get/create/delete/session-requests/state snapshot
- typed flow client exposes `actions.<actionName>` methods and snapshot state helpers
- client package exports runtime + type surfaces from index

### W1I-T2: Implement request/user SSE clients with resume support (I1)

Files:

- `packages/client/src/stream-client/createSSEClient.ts`

Acceptance criteria:

- request stream and optional user stream clients parse SSE frames
- callbacks dispatch by canonical event type
- dedupe behavior uses stream identity + `sequence_number`
- `Last-Event-ID` and `starting_after` resume controls are supported

### W1I-T3: Implement React wrappers, render helpers, and context/registry (I2-I4)

Files:

- `packages/react/src/hooks/useFlowAgent.ts`
- `packages/react/src/hooks/useSession.ts`
- `packages/react/src/hooks/useAction.ts`
- `packages/react/src/hooks/useRequestStream.ts`
- `packages/react/src/hooks/useTypedFlowClient.ts`
- `packages/react/src/components/ItemRenderer.ts`
- `packages/react/src/components/ItemsRenderer.ts`
- `packages/react/src/components/MessagesRenderer.ts`
- `packages/react/src/components/BlockRenderer.ts`
- `packages/react/src/registry/block-renderers.ts`
- `packages/react/src/context/FlowContext.ts`
- `packages/react/src/index.ts`

Acceptance criteria:

- wrappers delegate transport/session/stream operations to `@flow-state-dev/client`
- request-completed paths trigger snapshot refresh behavior in session wrappers
- render helpers consume canonical `OutputItem` shapes and block renderer mappings
- registry and context helpers are exported for app-level composition

### W1I-T4: Add tests and package wiring verification

Files:

- `packages/client/test/index.test.ts`
- `packages/client/test/action-client.test.ts`
- `packages/client/test/sessions.test.ts`
- `packages/client/test/stream-client.test.ts`
- `packages/react/test/index.test.ts`
- `packages/react/test/hooks.test.ts`
- `packages/react/test/context-registry-renderers.test.ts`
- `packages/client/package.json`
- `packages/react/package.json`
- `README.md`
- `docs/waves/wave-1/wave-1.i-journal.md`
- `docs/waves/wave-1/wave-1.i-changelog.md`
- `changelog.md`

Acceptance criteria:

- both packages have focused unit coverage for Wave 1.i surfaces
- cross-package script wiring is deterministic for local typecheck/test runs
- onboarding docs reflect that client/react are now implemented

## 5. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Client action/session/state API | `packages/client/src/action-client/executeAction.ts`, `packages/client/src/session-client/sessions.ts`, `packages/client/src/types/index.ts` | `pnpm --filter @flow-state-dev/client typecheck`, `pnpm --filter @flow-state-dev/client test` | client transport tests pass and APIs are exported |
| Client SSE transport | `packages/client/src/stream-client/createSSEClient.ts`, `packages/client/test/stream-client.test.ts` | `pnpm --filter @flow-state-dev/client test` | SSE parse/dispatch/resume tests pass |
| React wrapper hooks | `packages/react/src/hooks/*`, `packages/react/test/hooks.test.ts` | `pnpm --filter @flow-state-dev/react typecheck`, `pnpm --filter @flow-state-dev/react test` | wrappers execute against client APIs and tests pass |
| React render/registry/context surfaces | `packages/react/src/components/*`, `packages/react/src/registry/block-renderers.ts`, `packages/react/src/context/FlowContext.ts`, `packages/react/test/context-registry-renderers.test.ts` | `pnpm --filter @flow-state-dev/react test` | renderer + registry + context tests pass |
| Wave artifacts and changelog | `docs/waves/wave-1/wave-1.i-journal.md`, `docs/waves/wave-1/wave-1.i-changelog.md`, `changelog.md` | n/a | artifacts present and aligned |

## 6. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/client typecheck` passes
- [x] `pnpm --filter @flow-state-dev/client test` passes
- [x] `pnpm --filter @flow-state-dev/react typecheck` passes
- [x] `pnpm --filter @flow-state-dev/react test` passes
- [x] `pnpm -r --if-present typecheck` passes
- [x] `pnpm -r --if-present test` passes
- [x] contract spot-check completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave I
  - `../preperation/architecture/SERVER_AND_CLIENT.md`
  - `../preperation/architecture/STREAMING.md`
- [x] `docs/waves/wave-1/wave-1.i-journal.md` updated
- [x] `docs/waves/wave-1/wave-1.i-changelog.md` updated
- [x] `changelog.md` updated with Wave 1.i summary

## 7. Definition Of Done

Wave 1.i is done when:

- client package exposes canonical action/session/state APIs and request/user SSE transports
- typed flow-bound client actions are available on top of generic sendAction
- react package wraps client APIs for session/action/request-stream usage
- render/registry/context surfaces are exported for downstream app integration
- package-level tests validate Wave 1.i runtime behavior and export wiring

## 8. Handoff To Wave 1.j

Wave 1.j may assume:

- client/react package contracts exist for transport and render wrapper integration
- request-stream resume mechanics are consumable from `@flow-state-dev/client`
- hooks/renderer registry/context entrypoints are available for testing package and devtool integration
