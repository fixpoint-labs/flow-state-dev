# Wave 1.j - Testing Package (Canonical Wave J)

## 1. Objective

Implement canonical `@flow-state-dev/testing` utilities for deterministic block/flow verification, item-level assertions, snapshot traces, and generator mocking.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave J: J1-J6)
2. `../preperation/architecture/TESTING.md` (testing package contracts)
3. `../preperation/architecture/EXECUTION_AND_ERRORS.md` (error/runtime behavior expectations)
4. `../preperation/architecture/STREAMING.md` (item/provenance semantics)
5. `docs/waves/wave-1/wave-1.i.md` (handoff assumptions)

Conflict rule:

- if this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- test harness runtime context + in-memory seeded stores
- `testBlock`, `testSequencer`, `testRouter` helpers
- `testFlow` helper for action-level flow execution
- `testItems` query/assertion helper
- `snapshotTrace` helper
- `mockGenerator` utility
- `@flow-state-dev/testing` package API exports, README, and tests
- Wave 1.j wave artifacts and root changelog update

### Out of scope

- suspend/resume workflow test contracts
- app-specific fixtures/test harnesses
- CLI/devtool integration work (later waves)

## 4. Dependencies

- Wave 1.e-f-g runtime/store execution infrastructure
- Wave 1.h route/runtime registration foundations
- Wave 1.i client/react handoff assumptions

## 5. Task Plan

### W1J-T1: Implement test harness runtime context (J1)

Files:

- `packages/testing/src/runtime/createTestContext.ts`

Acceptance criteria:

- builds isolated in-memory execution context per test run
- supports seeded request/session/user/project state
- captures scope state mutations for assertions
- exposes deterministic emitted item access

### W1J-T2: Implement block/sequencer/router test helpers (J2)

Files:

- `packages/testing/src/test-utilities/testBlock.ts`
- `packages/testing/src/test-utilities/testSequencer.ts`
- `packages/testing/src/test-utilities/testRouter.ts`
- `packages/testing/src/test-utilities/types.ts`

Acceptance criteria:

- `testBlock` returns output/error/items/state/stateChanges/meta
- `testSequencer` extends block result with steps/work traces + loop iteration summary
- `testRouter` returns selected route for router assertions

### W1J-T3: Implement flow action test helper (J3)

Files:

- `packages/testing/src/test-utilities/testFlow.ts`

Acceptance criteria:

- executes flow action via server runtime (`runAction`) with seeded stores
- returns terminal status, request ID, output/error, and items

### W1J-T4: Implement item selectors and snapshot traces (J4)

Files:

- `packages/testing/src/test-utilities/testItems.ts`
- `packages/testing/src/snapshot/snapshotTrace.ts`

Acceptance criteria:

- provides canonical query helpers by type, phase, and block output selection
- produces stable trace summary payload for snapshot assertions

### W1J-T5: Implement generator mocks (J5)

Files:

- `packages/testing/src/mocks/mockGenerator.ts`

Acceptance criteria:

- deterministic scripted generator step playback
- resettable instance for repeatable tests

### W1J-T6: Export testing package API and add wave verification tests (J6)

Files:

- `packages/testing/src/index.ts`
- `packages/testing/test/index.test.ts`
- `packages/testing/test/test-utilities.test.ts`
- `packages/testing/test/mock-generator.test.ts`
- `packages/testing/README.md`

Acceptance criteria:

- package exports all canonical Wave J public utilities
- package tests cover harness utilities and mock behaviors
- README documents API and usage

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Harness/runtime context | `packages/testing/src/runtime/createTestContext.ts` | `pnpm --filter @flow-state-dev/testing build` | package compiles with seeded context runtime |
| Test utility APIs | `packages/testing/src/test-utilities/*.ts` | `pnpm --filter @flow-state-dev/testing test` | utilities return canonical result shapes |
| Snapshot + item helpers | `packages/testing/src/snapshot/snapshotTrace.ts`, `packages/testing/src/test-utilities/testItems.ts` | `pnpm --filter @flow-state-dev/testing test` | selectors/traces produce deterministic outputs |
| Generator mock utility | `packages/testing/src/mocks/mockGenerator.ts` | `pnpm --filter @flow-state-dev/testing test` | scripted steps + reset semantics validated |
| Package docs + wave artifacts | `packages/testing/README.md`, `docs/waves/wave-1/wave-1.j-*.md`, `changelog.md` | n/a | wave documentation and root changelog aligned |

## 7. Wave Gate Checklist

- [x] `pnpm --filter @flow-state-dev/testing build` passes
- [x] `pnpm --filter @flow-state-dev/testing typecheck` passes
- [x] `pnpm --filter @flow-state-dev/testing test` passes
- [x] architecture contract spot-check completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave J)
  - `../preperation/architecture/TESTING.md`
- [x] `docs/waves/wave-1/wave-1.j-journal.md` updated
- [x] `docs/waves/wave-1/wave-1.j-changelog.md` updated
- [x] `changelog.md` updated with Wave 1.j summary

## 8. Definition Of Done

Wave 1.j is done when:

- `@flow-state-dev/testing` exports canonical testing utilities for block/flow/item/snapshot/generator test paths
- package-level tests validate utility behavior and public exports
- wave artifacts and root changelog reflect implemented surfaces

## 9. Handoff To Wave 1.k

Wave 1.k may assume:

- deterministic framework-level test harness utilities are available in `@flow-state-dev/testing`
- example flows can now be validated with canonical `testFlow` and `testItems` helpers
- snapshot-style item/provenance trace utilities are available for regression assertions
