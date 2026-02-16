# Wave 1.g - Execution and Error Runtime (Canonical Wave G)

## 1. Objective

Implement canonical execution and error runtime primitives in `@flow-state-dev/server`: normalized flow errors, retry/rescue/work semantics, block-kind execution dispatch, request action runner lifecycle, and internal no-op execution seams for future middleware.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/planning/PHASE_1_BUILD_PLAYBOOK.md`
2. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave G: G1-G8)
3. `../preperation/architecture/EXECUTION_AND_ERRORS.md` (runtime and error behavior)
4. `../preperation/architecture/FLOW_SYSTEM.md` (request/action lifecycle hooks and work semantics)
5. `../preperation/architecture/BLOCKS.md` (block-kind runtime contracts and retry/rescue/work semantics)
6. `../preperation/architecture/SERVER_AND_CLIENT.md` (server execution API shape and request lifecycle integration)
7. `../preperation/architecture/MIDDLEWARE_EXTENSION_PLAN.md` (Phase 1 internal seam readiness)
8. `docs/waves/wave-1/wave-1.f.md` (streaming runtime handoff assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- error classes and throw normalization in `packages/server/src/errors/*`
- retry policy merge and retry execution utility in `packages/server/src/execution/retry.ts`
- block-kind dispatch runtime in `packages/server/src/execution/execute*.ts`
- rescue routing helper in `packages/server/src/execution/rescue.ts`
- work queue and convergence controls in `packages/server/src/execution/work-queue.ts`
- request action runner with action/request lifecycle observer ordering in `packages/server/src/execution/runAction.ts`
- execution barrel and root server export wiring
- internal execution metadata + no-op seam hooks for middleware-readiness
- unit tests and wave artifacts

### Out of scope

- flow registry and HTTP routing (Wave H)
- client/react invocation and rendering integration (Waves I+)
- public middleware registration/interception APIs (Phase 2)

## 4. Dependencies

- Wave 1.e context/stores are available.
- Wave 1.f streaming runtime (`ResponseEmitter`, replay/encoding) is available.
- Core block definitions from Waves 1.c-1.d are stable.

## 5. Task Plan

### W1G-T1: Implement error classes and normalization (G1)

Files:

- `packages/server/src/errors/flow-error.ts`
- `packages/server/src/errors/normalize-error.ts`

Acceptance criteria:

- canonical `FlowError` class surface and typed subclasses exist
- non-`Error` throws normalize into `FlowError`
- normalization supports block/scope attribution and retryability defaults

### W1G-T2: Implement retry engine (G2)

Files:

- `packages/server/src/execution/retry.ts`

Acceptance criteria:

- block and runtime/default retry policy merge utility exists
- retryable error filtering is supported
- retry execution utility retries within configured bounds

### W1G-T3: Implement block dispatch runtime (G3)

Files:

- `packages/server/src/execution/executeBlock.ts`
- `packages/server/src/execution/executeHandler.ts`
- `packages/server/src/execution/executeGenerator.ts`
- `packages/server/src/execution/executeSequencer.ts`
- `packages/server/src/execution/executeRouter.ts`

Acceptance criteria:

- dispatch by canonical block kinds (`handler|generator|sequencer|router`)
- router execution requires selected block contract and executes selected block
- generator execution path remains loop-capable by delegating to generator block runtime
- provider-native tool shaping remains internal to runtime paths (no public generator tool API changes)

### W1G-T4: Implement rescue boundary routing (G4)

Files:

- `packages/server/src/execution/rescue.ts`

Acceptance criteria:

- rescue handler matching by error-type list is implemented
- fallback rescue behavior is supported

### W1G-T5: Implement work queue and convergence (G5)

Files:

- `packages/server/src/execution/work-queue.ts`

Acceptance criteria:

- work task failures are non-aborting by default
- `waitForWork({ failOnError: true })` promotes queued failures

### W1G-T6: Implement request action runner (G6)

Files:

- `packages/server/src/execution/runAction.ts`

Acceptance criteria:

- request lifecycle ordering follows canonical hooks (`onStarted`, terminal `onCompleted`/`onErrored`, `onFinished`)
- action-level and request-level observers are dispatched in canonical order
- request status/store updates and request stream lifecycle events are emitted consistently

### W1G-T7: Wire execution exports (G7)

Files:

- `packages/server/src/execution/index.ts`
- `packages/server/src/index.ts`

Acceptance criteria:

- execution and error modules are exported from `@flow-state-dev/server`
- no public middleware API leakage

### W1G-T8: Add internal execution seams and metadata (G8)

Files:

- `packages/server/src/execution/types.ts`
- `packages/server/src/execution/internal/*`
- `packages/server/src/execution/executeBlock.ts`
- `packages/server/src/execution/executeGenerator.ts`
- `packages/server/src/execution/runAction.ts`

Acceptance criteria:

- internal seam hooks exist around block execution and normalization paths
- internal `ExecutionMetadata` bag is available for request/block/tool correlation
- no-op seam configuration preserves runtime behavior

### W1G-T9: Add tests and wave artifacts

Files:

- `packages/server/test/execution*.test.ts`
- `docs/waves/wave-1/wave-1.g-journal.md`
- `docs/waves/wave-1/wave-1.g-changelog.md`
- `changelog.md`

Acceptance criteria:

- tests cover error normalization, retry filtering, dispatch behavior, rescue routing, work queue convergence, lifecycle ordering, and no-op seam parity
- wave journal/changelog capture verification evidence

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Error classes + normalization | `packages/server/src/errors/flow-error.ts`, `packages/server/src/errors/normalize-error.ts` | `pnpm --filter @flow-state-dev/server test` | normalized/typed error tests pass |
| Retry engine | `packages/server/src/execution/retry.ts` | `pnpm --filter @flow-state-dev/server test` | retry merge/filter/attempt tests pass |
| Block dispatch runtime | `packages/server/src/execution/executeBlock.ts`, `packages/server/src/execution/execute*.ts` | `pnpm --filter @flow-state-dev/server test` | block kind dispatch and router-selection tests pass |
| Rescue + work queue runtime | `packages/server/src/execution/rescue.ts`, `packages/server/src/execution/work-queue.ts` | `pnpm --filter @flow-state-dev/server test` | rescue matching and `waitForWork` convergence tests pass |
| Request action runner | `packages/server/src/execution/runAction.ts` | `pnpm --filter @flow-state-dev/server test` | lifecycle ordering and terminal status tests pass |
| Execution seam metadata/no-op seams | `packages/server/src/execution/types.ts`, `packages/server/src/execution/internal/*` | `pnpm --filter @flow-state-dev/server test` | seam parity tests pass with no behavior drift |
| Export wiring + wave artifacts | `packages/server/src/execution/index.ts`, `packages/server/src/index.ts`, `docs/waves/wave-1/wave-1.g-*`, `changelog.md` | `pnpm -r --if-present typecheck` | workspace typecheck passes and artifacts exist |

## 7. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/server typecheck` passes
- [x] `pnpm --filter @flow-state-dev/server test` passes
- [x] `pnpm -r --if-present typecheck` passes
- [x] `pnpm -r --if-present test` passes
- [x] contract spot-check completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave G
  - `../preperation/architecture/EXECUTION_AND_ERRORS.md`
  - `../preperation/architecture/FLOW_SYSTEM.md`
  - `../preperation/architecture/BLOCKS.md`
  - `../preperation/architecture/MIDDLEWARE_EXTENSION_PLAN.md`
- [x] `docs/waves/wave-1/wave-1.g-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.g-journal.md` updated
- [x] `changelog.md` updated with Wave 1.g summary

## 8. Definition Of Done

Wave 1.g is done when:

- execution runtime dispatches block kinds through server-owned execution modules
- error normalization, retry, rescue, and work convergence utilities are implemented and test-covered
- request action runner enforces canonical lifecycle observer ordering and terminal status behavior
- internal execution seam metadata and no-op seam points exist for future middleware without behavior changes
- server package exports execution/error primitives for downstream registry/route integration

## 9. Handoff To Wave 1.h

Wave 1.h may assume:

- action execution runtime exists in `@flow-state-dev/server`
- request lifecycle and stream status emission semantics are available for route handlers
- execution internals include no-op-safe middleware seam hooks and metadata bag
