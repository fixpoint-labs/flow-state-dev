# Wave 1.e - Server Context and Stores (Canonical Wave E)

## 1. Objective

Implement Phase 1 server runtime context composition and persistence primitives so downstream execution/streaming waves can rely on canonical scope handles, versioned state containers, CAS retries, and store adapters.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/planning/PHASE_1_BUILD_PLAYBOOK.md`
2. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave E: E1-E5)
3. `../preperation/architecture/STATE_AND_SCOPES.md` (scope hierarchy, state ops, CAS policy, adapters)
4. `../preperation/architecture/SERVER_AND_CLIENT.md` (store responsibilities and server package boundaries)
5. `docs/waves/wave-1/wave-1.d.md` (core-flow/runtime handoff assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- server context types and `createExecutionContext` runtime factory
- require-user and require-session enforcement at context creation
- state container implementation with versioned persist/read
- optimistic CAS retry primitive with bounded retries and explicit exhaustion error
- memory store adapters for request/session/user/project
- filesystem store adapters for request/session/user/project
- server store barrel exports
- wave artifacts and root changelog update

### Out of scope

- block execution runtime (`executeBlock`, `runAction`, rescue/retry orchestration)
- stream emitter/SSE framing/replay logic
- flow registry and route adapters

## 4. Dependencies

- Wave 1.d complete (`defineFlow`, core flow types, block/runtime exports)
- `@flow-state-dev/server` remains the primary package for this wave

## 5. Task Plan

### W1E-T1: Implement server context types and runtime context factory (E1)

Files:

- `packages/server/src/context/types.ts`
- `packages/server/src/context/createExecutionContext.ts`

Acceptance criteria:

- context includes composed request/session/user/project handles
- user requirement enforced (`userId` required)
- session requirement enforced when flow requires session
- context exposes canonical BlockContext-compatible runtime fields

### W1E-T2: Implement CAS primitive and concurrency error contract (E2)

Files:

- `packages/server/src/stores/cas.ts`

Acceptance criteria:

- bounded retry loop with exponential backoff
- explicit `ConcurrentModificationError` on retry exhaustion
- reusable CAS helper for state mutation operations

### W1E-T3: Implement versioned state container and canonical state ops (E2)

Files:

- `packages/server/src/stores/state-container.ts`

Acceptance criteria:

- in-memory state container supports `read/getVersion/persist`
- `createScopeStateOps` supports `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`
- state ops are applied through CAS helper rather than ad hoc read-modify-write

### W1E-T4: Implement memory and filesystem store adapters (E3 + E4)

Files:

- `packages/server/src/stores/memory/*.ts`
- `packages/server/src/stores/filesystem/*.ts`

Acceptance criteria:

- CRUD + list operations implemented for all four store kinds
- memory adapters are test-friendly and non-shared between instances
- filesystem adapters use durable file writes and return persisted records

### W1E-T5: Add store exports and server root wiring (E5)

Files:

- `packages/server/src/stores/index.ts`
- `packages/server/src/index.ts`

Acceptance criteria:

- store constructors/helpers exported from server package root
- context exports available from server package root
- no server-to-client/react boundary leakage introduced

### W1E-T6: Add unit verification and wave artifacts

Files:

- `packages/server/test/*.test.ts`
- `docs/waves/wave-1/wave-1.e.md`
- `docs/waves/wave-1/wave-1.e-journal.md`
- `docs/waves/wave-1/wave-1.e-changelog.md`
- `changelog.md`

Acceptance criteria:

- tests cover CAS/state container, context composition, and memory/filesystem stores
- wave documentation captures command evidence and deliverable mapping

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Context runtime factory and types implemented | `packages/server/src/context/createExecutionContext.ts`, `packages/server/src/context/types.ts` | `pnpm --filter @flow-state-dev/server typecheck` | no TS errors; context enforces user/session policy |
| CAS primitive + exhaustion error implemented | `packages/server/src/stores/cas.ts` | `pnpm --filter @flow-state-dev/server test` | CAS retry + exhaustion tests pass |
| Versioned state container + state ops implemented | `packages/server/src/stores/state-container.ts` | `pnpm --filter @flow-state-dev/server test` | state ops mutate via CAS and persist expected state |
| Filesystem store adapters implemented | `packages/server/src/stores/filesystem/*.ts` | `pnpm --filter @flow-state-dev/server test` | filesystem CRUD/list tests pass |
| In-memory store adapters implemented | `packages/server/src/stores/memory/*.ts` | `pnpm --filter @flow-state-dev/server test` | memory CRUD/list/filter tests pass |
| Store and server exports wired | `packages/server/src/stores/index.ts`, `packages/server/src/index.ts` | `pnpm -r --if-present typecheck` | workspace typecheck passes with new exports |
| Wave artifacts and changelog updated | `docs/waves/wave-1/wave-1.e-*`, `changelog.md` | manual review | artifacts and summary entries present |

## 7. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/server typecheck` passes
- [x] `pnpm --filter @flow-state-dev/server test` passes
- [x] `pnpm -r --if-present typecheck` passes
- [x] `pnpm -r --if-present test` passes
- [x] contract spot-check complete against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave E
  - `../preperation/architecture/STATE_AND_SCOPES.md`
  - `../preperation/architecture/SERVER_AND_CLIENT.md`
- [x] `docs/waves/wave-1/wave-1.e-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.e-journal.md` updated
- [x] `changelog.md` updated

## 8. Definition Of Done

Wave 1.e is done when:

- server context creation composes canonical scope handles and enforces user/session policy
- state mutation primitives support versioned persistence with CAS retry behavior
- filesystem and in-memory store adapters exist for request/session/user/project scopes
- store/context APIs are exported for downstream server runtime waves
- unit tests and wave artifacts provide verification evidence

## 9. Handoff To Wave 1.f

Wave 1.f may assume:

- context factory returns typed scope handles backed by CAS-safe state ops
- request/session/user/project persistence primitives exist in both memory and filesystem forms
- server package exposes reusable store/context APIs for streaming runtime integration
