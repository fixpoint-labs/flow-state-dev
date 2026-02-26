# Wave 1.b - Core Types and Schemas (Canonical Wave B)

## 1. Objective

Implement canonical `@flow-state-dev/core` type contracts and schema utilities so downstream builder/runtime waves can rely on stable typing for blocks, flows, scopes/resources/state, and streaming items/events.

This wave is complete when Wave 1.c can implement block builders against concrete core type exports without revisiting type surface decisions.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/planning/PHASE_1_BUILD_PLAYBOOK.md` (wave gates and execution constraints)
2. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave B tasks B0-B5)
3. `../preperation/architecture/ARCHITECTURE_OVERVIEW.md` (core public boundary and package responsibilities)
4. `../preperation/architecture/BLOCKS.md` (block contracts, context generics, connector types)
5. `../preperation/architecture/FLOW_SYSTEM.md` (flow/action/types, tools config, lifecycle contracts)
6. `../preperation/architecture/STATE_AND_SCOPES.md` (scope handles, state ops, resources/projections typing)
7. `../preperation/architecture/STREAMING.md` (item/content model and stream envelope types)

Conflict rule:

- If this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- Core type modules for block, flow, scope, resource, and state contracts.
- Canonical item/content and stream event type modules.
- Core schema helper modules used by block/flow typing.
- `packages/core` export wiring updates required to expose new type surfaces.
- Compile-time type checks for connector/sequencer inference smoke coverage.

### Out of scope

- Runtime builder behavior (`handler`, `generator`, `sequencer`, `router`) implementation.
- Flow runtime implementation (`defineFlow` execution semantics).
- Server runtime execution, persistence, routing, or streaming emitter behavior.
- Client/react/cli/devtool runtime APIs.

## 4. Dependencies

- Wave 1.a complete: workspace/package scaffolding and core subpath exports in place.
- TypeScript workspace typecheck pipeline operational.
- `packages/core` is the only package changed for canonical Wave B implementation.

## 5. Task Plan

### W1B-T1: Define block typing strategy and shared context generics (B0 + B1 foundation)

Purpose:

- Establish canonical block-level generics and connector primitives used by all block builders.

Files to create/modify:

- `packages/core/src/types/block.ts`
- `packages/core/src/types/index.ts`

Acceptance criteria:

- `BlockKind` is exactly `handler | generator | sequencer | router`.
- `BlockDefinition`, `BlockConfig`, and `ConnectorFn` are exported.
- `BlockContext<TRequestState, TSessionState, TUserState, TProjectState>` generic parameters are present and used in connector/block signatures.

### W1B-T2: Implement flow/action/type contracts and inference hooks (B0 + B2)

Purpose:

- Provide canonical flow and action typing surface expected by Wave 1.d (`defineFlow`) and downstream packages.

Files to create/modify:

- `packages/core/src/types/flow.ts`
- `packages/core/src/types/index.ts`

Acceptance criteria:

- `FlowDefinition`, `FlowType`, `FlowInstance`, and `ActionConfig` are exported.
- Flow lifecycle hook type names use canonical past-tense contracts (`onStarted`, `onCompleted`, `onErrored`, `onFinished`, `onStepErrored`).
- Flow typing includes scope config and tools config surfaces aligned to `FLOW_SYSTEM.md`.

### W1B-T3: Implement scope/state/resource/projection type contracts (B3)

Purpose:

- Lock state and resource typing surfaces used by core builders and server runtime.

Files to create/modify:

- `packages/core/src/types/scope.ts`
- `packages/core/src/types/state.ts`
- `packages/core/src/types/resource.ts`
- `packages/core/src/types/index.ts`

Acceptance criteria:

- Scope identities and handle types exist for `request`, `session`, `user`, `project`.
- State operation contracts include canonical methods (`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`).
- Resource/projection typing includes `defineResource`, `defineProjection`, `StateOf`, and `ContextOf` exports.

### W1B-T4: Implement canonical items/content/event type modules (B4)

Purpose:

- Provide the canonical item-first streaming type surface consumed by server/client/react/testing.

Files to create/modify:

- `packages/core/src/items/types.ts`
- `packages/core/src/items/content.ts`
- `packages/core/src/items/events.ts`
- `packages/core/src/items/index.ts`

Acceptance criteria:

- `OutputItem` union includes standard item types and `fsd:*` extension types from `STREAMING.md`.
- `Content` taxonomy exports canonical content variants (`output_text`, `reasoning_text`, `refusal`, `file`).
- Stream event envelope types include `sequence_number` and canonical request/item/content lifecycle event names.

### W1B-T5: Add core schema helpers and export wiring (B5)

Purpose:

- Provide shared schema primitives for core type and builder modules.

Files to create/modify:

- `packages/core/src/schema/common.ts`
- `packages/core/src/schema/index.ts`
- `packages/core/src/types/index.ts`
- `packages/core/src/index.ts`

Acceptance criteria:

- Schema helper module exports common zod helpers used by core type definitions.
- Root/core type exports remain clean and avoid server/runtime leakage.
- Existing subpath export contract (`@flow-state-dev/core/types`, `@flow-state-dev/core/items`) continues to resolve.

### W1B-T6: Add type-level smoke checks for connector/sequencer inference (B0 validation)

Purpose:

- Prove baseline type inference behavior before builder runtime work begins.

Files to create/modify:

- `packages/core/src/types/tests/sequencer-connectors.type-test.ts` (or equivalent compile-only test file)
- `packages/core/src/types/tests/flow-state-inference.type-test.ts` (or equivalent compile-only test file)

Acceptance criteria:

- Type-level smoke files compile under workspace typecheck.
- Smoke checks cover at minimum connector chaining and flow scope-state generic threading.

### W1B-T7: Record wave execution artifacts

Purpose:

- Ensure Wave 1.b is traceable and verifiable for downstream execution.

Files to create/modify:

- `docs/waves/wave-1/wave-1.b.md`
- `docs/waves/wave-1/wave-1.b-journal.md`
- `docs/waves/wave-1/wave-1.b-changelog.md`
- `changelog.md`

Acceptance criteria:

- Journal captures exact verification commands and outcomes.
- Wave changelog maps deliverables to evidence.
- Root changelog includes concise Wave 1.b summary.

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Block/connector/core context types implemented | `packages/core/src/types/block.ts`, `packages/core/src/types/index.ts` | `pnpm --filter @flow-state-dev/core typecheck` | No type errors; block/context primitives resolve |
| Flow/action type contracts implemented | `packages/core/src/types/flow.ts`, `packages/core/src/types/index.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Flow/action types compile and export cleanly |
| Scope/state/resource/projection types implemented | `packages/core/src/types/scope.ts`, `packages/core/src/types/state.ts`, `packages/core/src/types/resource.ts`, `packages/core/src/types/index.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Scope/resource/state type surfaces compile |
| Item/content/stream event types implemented | `packages/core/src/items/types.ts`, `packages/core/src/items/content.ts`, `packages/core/src/items/events.ts`, `packages/core/src/items/index.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Item/content/event modules compile and export |
| Schema helper modules implemented | `packages/core/src/schema/common.ts`, `packages/core/src/schema/index.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Schema helper exports compile and are consumable |
| Connector/flow inference smoke checks added | `packages/core/src/types/tests/*.type-test.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Smoke files compile with expected inference |
| Core boundary remains canonical | `packages/core/src/index.ts`, `packages/core/src/types/index.ts`, `packages/core/src/items/index.ts`, `packages/core/package.json` | `pnpm -r typecheck` | Workspace typecheck passes with subpath imports intact |
| No absolute path imports introduced | `packages/core/src/**/*` | `rg -n "from ['\\\"]/|from \\\"/" packages/core/src` | No matches |
| Wave artifacts captured | `docs/waves/wave-1/wave-1.b-journal.md`, `docs/waves/wave-1/wave-1.b-changelog.md` | manual review | Files include command log and verification mapping |
| Root changelog summary recorded | `changelog.md` | manual review | Wave 1.b summary entry present |

## 7. Wave Gate Checklist

Required to close Wave 1.b:

- [x] `pnpm -r typecheck` passes
- [x] targeted tests for changed packages pass (if tests exist in this wave)
- [x] lint/static checks configured for changed packages pass
- [x] contract spot-checks completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave B
  - `../preperation/architecture/BLOCKS.md`
  - `../preperation/architecture/FLOW_SYSTEM.md`
  - `../preperation/architecture/STATE_AND_SCOPES.md`
  - `../preperation/architecture/STREAMING.md`
- [x] `docs/waves/wave-1/wave-1.b-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.b-journal.md` updated
- [x] `changelog.md` updated with Wave 1.b summary

Execution note:

- TypeScript package install remains blocked in this environment (`ENOTFOUND registry.npmjs.org`), so `typecheck` verification runs through `scripts/typecheck.mjs` static checks.

## 8. Definition Of Done (Wave 1.b)

Wave 1.b is done when all of the following are true:

- Core type contracts for block/flow/scope/resource/state are implemented and exported.
- Canonical item/content/event types are implemented and exported.
- Schema helper modules are in place for downstream core builder implementation.
- Type-level smoke checks cover connector/sequencer and flow state inference basics.
- Verification artifacts document exact commands and pass/fail outcomes.

## 9. Handoff To Wave 1.c

Wave 1.c may assume:

- stable type definitions exist for all canonical block kinds and flow contracts
- scope/resource/state typing surfaces are available for builder signatures
- canonical item/content/event types are available via `@flow-state-dev/core/items`
- schema helper primitives are available for block builder validation and inference
