# Wave 1.c - Core Block Builders (Canonical Wave C)

## 1. Objective

Implement canonical `@flow-state-dev/core` runtime block builders so Wave 1.d can compose flows with concrete `handler`, `generator`, `sequencer`, and `router` definitions backed by shared execution wiring and connector behavior.

This wave is complete when the core package exports all canonical block builders with working runtime metadata/validation plumbing and sequencer DSL method signatures.

## 2. Canonical Inputs

Primary authority for this wave:

1. `../preperation/planning/PHASE_1_BUILD_PLAYBOOK.md` (execution order and gate requirements)
2. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave C tasks C1-C5)
3. `../preperation/architecture/ARCHITECTURE_OVERVIEW.md` (canonical block responsibilities)
4. `../preperation/architecture/BLOCKS.md` (builder APIs, connector behavior, sequencer DSL, generator/router rules)
5. `docs/waves/wave-1/wave-1.b.md` (handoff assumptions and guaranteed type surfaces)

Conflict rule:

- If this wave plan conflicts with `../preperation/architecture/*`, architecture docs win.

## 3. Scope

### In scope

- Shared runtime builder helper for canonical block metadata wiring.
- `handler`, `generator`, `sequencer`, and `router` builder implementation in `packages/core`.
- Sequencer 14-method DSL type signatures and method-level connector overloads.
- Core blocks barrel and root export wiring for runtime builders.
- Wave 1.c execution artifacts and changelog updates.

### Out of scope

- `defineFlow` and flow runtime APIs (Wave 1.d).
- Server execution runtime, persistence, or stream transport implementation.
- Client/react/testing/cli behavior changes.
- Non-canonical block kinds or Phase 2+ runtime features.

## 4. Dependencies

- Wave 1.b complete with stable core type/schema/item contracts.
- `packages/core` remains the primary changed package for Wave 1.c runtime builder work.

## 5. Task Plan

### W1C-T1: Implement shared builder runtime helper (C1 foundation)

Purpose:

- Centralize block metadata wiring, schema validation, retry wrapping, and connector chaining behavior used by all block kinds.

Files to create/modify:

- `packages/core/src/blocks/internal/build-block.ts`

Acceptance criteria:

- Shared helper creates `BlockDefinition` with canonical metadata fields.
- `connectInput` and `connectOutput` return re-bound block definitions with typed connectors.
- Input/output schema validation is applied when schemas are configured.

### W1C-T2: Implement `handler` builder (C1)

Purpose:

- Provide canonical basic executable block builder with required `execute` function and shared runtime behavior.

Files to create/modify:

- `packages/core/src/blocks/handler.ts`
- `packages/core/src/blocks/internal/build-block.ts`

Acceptance criteria:

- `handler(config)` returns `BlockDefinition<TInput, TOutput>`.
- `execute` is required in handler config type.
- Builder preserves canonical optional fields (`render`, `message`, retry, schemas, hooks).

### W1C-T3: Implement loop-capable `generator` builder (C2)

Purpose:

- Provide canonical generator config surface with bounded loop execution, tool participation, and repair policy behavior for schema-constrained outputs.

Files to create/modify:

- `packages/core/src/blocks/generator.ts`

Acceptance criteria:

- Generator config includes canonical model/prompt/tool/message/render surface.
- Runtime enforces bounded loop behavior (`maxIterations` and loop controls).
- Repair config is supported for output-schema mismatch handling.

### W1C-T4: Implement sequencer builder and DSL signatures (C3)

Purpose:

- Provide canonical composition primitive with 14 DSL methods and method-level connector overloads for typed chaining.

Files to create/modify:

- `packages/core/src/blocks/sequencer.ts`
- `packages/core/src/blocks/sequencer-methods.ts`

Acceptance criteria:

- Sequencer exposes all Phase 1 DSL methods (`then`, `thenIf`, `map`, `parallel`, `forEach`, `doUntil`, `doWhile`, `loopBack`, `work`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`).
- Connector overloads are available on relevant methods for inference-first composition.
- Sequencer still satisfies `BlockDefinition` contract.

### W1C-T5: Implement `router` builder (C4)

Purpose:

- Provide runtime route selection block that validates returned route candidates and executes selected block definitions.

Files to create/modify:

- `packages/core/src/blocks/router.ts`

Acceptance criteria:

- Router config `execute` returns a candidate block definition.
- Runtime validates candidate against declared `routes`.
- Selected route executes with canonical input/output contract.

### W1C-T6: Wire canonical block exports (C5)

Purpose:

- Expose runtime builders through stable core package boundaries.

Files to create/modify:

- `packages/core/src/blocks/index.ts`
- `packages/core/src/index.ts`

Acceptance criteria:

- Core root exports canonical runtime builders.
- Export wiring does not leak server-only contracts.

### W1C-T7: Record wave artifacts and verification evidence

Purpose:

- Keep Wave 1.c traceable for next-wave execution.

Files to create/modify:

- `docs/waves/wave-1/wave-1.c.md`
- `docs/waves/wave-1/wave-1.c-journal.md`
- `docs/waves/wave-1/wave-1.c-changelog.md`
- `changelog.md`

Acceptance criteria:

- Journal includes command log and contract spot-check notes.
- Wave changelog maps deliverables to evidence.
- Root changelog includes concise Wave 1.c summary.

## 6. Deliverables And Verification

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| Shared block runtime helper implemented | `packages/core/src/blocks/internal/build-block.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Helper compiles and resolves all relative imports |
| Handler builder implemented with connectors | `packages/core/src/blocks/handler.ts`, `packages/core/src/blocks/internal/build-block.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Handler builder compiles and returns canonical `BlockDefinition` |
| Generator builder implemented with loop + repair support | `packages/core/src/blocks/generator.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Generator config/runtime surface compiles with bounded loop options |
| Sequencer builder and DSL signatures implemented | `packages/core/src/blocks/sequencer.ts`, `packages/core/src/blocks/sequencer-methods.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Sequencer DSL module compiles with 14 method signatures |
| Router builder implemented with route validation | `packages/core/src/blocks/router.ts` | `pnpm --filter @flow-state-dev/core typecheck` | Router builder compiles and validates route candidates |
| Blocks barrel and root exports wired | `packages/core/src/blocks/index.ts`, `packages/core/src/index.ts` | `pnpm -r typecheck` | Workspace typecheck passes with new core exports |
| No absolute imports introduced | `packages/core/src/**/*` | `rg -n "from ['\\\"]/|from \\\"/" packages/core/src` | No matches |
| Wave execution artifacts captured | `docs/waves/wave-1/wave-1.c-journal.md`, `docs/waves/wave-1/wave-1.c-changelog.md` | manual review | Files contain verification and evidence mapping |
| Root changelog summary recorded | `changelog.md` | manual review | Wave 1.c summary bullet list present |

## 7. Wave Gate Checklist

Required to close Wave 1.c:

- [x] `pnpm -r typecheck` passes
- [x] targeted tests for changed packages pass (if tests exist in this wave)
- [x] lint/static checks configured for changed packages pass
- [x] contract spot-checks completed against:
  - `../preperation/architecture/IMPLEMENTATION_PLAN.md` Wave C
  - `../preperation/architecture/BLOCKS.md`
  - `../preperation/architecture/ARCHITECTURE_OVERVIEW.md`
- [x] `docs/waves/wave-1/wave-1.c-changelog.md` updated
- [x] `docs/waves/wave-1/wave-1.c-journal.md` updated
- [x] `changelog.md` updated with Wave 1.c summary

Execution note:

- TypeScript package install remains unavailable in this environment, so verification runs through `scripts/typecheck.mjs` static checks in place of `tsc` compilation.

## 8. Definition Of Done

Wave 1.c is done when all of the following are true:

- canonical runtime builders for `handler`, `generator`, `sequencer`, and `router` are implemented in `packages/core/src/blocks/*`
- shared connector and metadata wiring logic exists for cross-block consistency (`connectInput` / `connectOutput`)
- sequencer method signatures and connector overloads are available for fluent typed composition
- core root exports include the canonical runtime builders for downstream wave consumption
- verification artifacts document commands and outcomes for this wave

## 9. Handoff To Wave 1.d

Wave 1.d may assume:

- canonical block builders are implemented and exported from `@flow-state-dev/core`
- shared connector behavior (`connectInput`/`connectOutput`) is available across block kinds
- sequencer fluent DSL signatures are available for typed flow action composition
- router block selection/validation behavior exists for runtime route dispatch
