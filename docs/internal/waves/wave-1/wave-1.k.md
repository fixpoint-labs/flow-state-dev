# Wave 1.k - Example Flows Correction (Wave K Redo)

## Objective

Replace the incorrect Wave 1.k `apps/web` implementation with canonical `examples/*` flows that demonstrate Phase 1 patterns end-to-end.

## Canonical Inputs

1. `../preperation/architecture/IMPLEMENTATION_PLAN.md` (Wave K intent)
2. `../preperation/architecture/FLOW_SYSTEM.md`
3. `../preperation/architecture/BLOCKS.md`
4. `../preperation/architecture/SERVER_AND_CLIENT.md`
5. `/Users/jakehoffner/Projects/flow-state-dev/corrections/WAVE_1K_CORRECTION.md` (override authority)

If docs conflict, `../preperation/architecture/*` and `WAVE_1K_CORRECTION.md` are authoritative.

## Scope

### In scope

- Delete `apps/web`.
- Create `examples/hello-chat` and `examples/kitchen-sink` workspace packages.
- Implement corrected flow definitions, extracted blocks, React usage examples, and tests.
- Add runtime support required by corrected examples:
  - persisted scope resources in execution context
  - projection computation with scope resources in session-state route
  - `fsd:block_output` emission for block executions
- Add testing-harness seeding support for nested `state` + `resources` seeds.
- Update Wave 1.k docs/journal/changelog and root onboarding/changelog references.

### Out of scope

- CLI command surfaces (Wave L)
- Devtool feature implementation (Wave M)
- End-to-end HTTP integration suites (Wave N)

## Task Breakdown

### W1K-R1: Runtime and testing alignment

- `packages/server/src/context/createExecutionContext.ts`
- `packages/server/src/routes/http-handlers.ts`
- `packages/server/src/execution/executeBlock.ts`
- `packages/core/src/blocks/router.ts`
- `packages/testing/src/runtime/createTestContext.ts`
- `packages/testing/src/test-utilities/testFlow.ts`
- `packages/testing/src/test-utilities/types.ts`

Acceptance:

- scope resources are readable/writable from blocks and persisted to stores
- projection `compute` functions can read configured scope resources
- block runtime emits `fsd:block_output` items
- router selection is safe for sequencer routes (`.then` thenable edge)
- testing seeds support nested scope `state` and `resources`

### W1K-R2: Examples replacement

- delete `apps/web`
- add `examples/hello-chat/**`
- add `examples/kitchen-sink/**`

Acceptance:

- hello-chat demonstrates session state, client projection, generator `clientOutput`/`llmOutput`, and `devuser`
- kitchen-sink demonstrates all block kinds, resources, session+user projections, router-by-context, sequencer DSL depth, renderKey, and block renderers
- no `as any` / `as FlowInstance` in example flow/block/test files

### W1K-R3: Docs and workspace alignment

- `pnpm-workspace.yaml`
- `tsconfig.json`
- `README.md`
- `docs/waves/wave-1/wave-1.k.md`
- `docs/waves/wave-1/wave-1.k-journal.md`
- `docs/waves/wave-1/wave-1.k-changelog.md`
- `changelog.md`

Acceptance:

- workspace references point to `examples/*`
- onboarding/docs/changelog no longer reference `apps/web`
- Wave 1.k artifacts reflect corrected implementation and verification

## Deliverables and Verification Gates

| Deliverable | Evidence | Verification |
|---|---|---|
| hello-chat example package | `examples/hello-chat/**` | `pnpm --filter @flow-state-dev/example-hello-chat typecheck` + `pnpm --filter @flow-state-dev/example-hello-chat test` |
| kitchen-sink example package | `examples/kitchen-sink/**` | `pnpm --filter @flow-state-dev/example-kitchen-sink typecheck` + `pnpm --filter @flow-state-dev/example-kitchen-sink test` |
| runtime resource/block-output/router fixes | server/core/testing files above | `pnpm --filter @flow-state-dev/server test` + `pnpm --filter @flow-state-dev/testing test` |
| legacy/cast cleanliness in examples | `examples/**` | `grep -R "as any" examples/` returns empty, `grep -R "as FlowInstance" examples/` returns empty, `grep -R "PartRenderer\|\.parts" examples/` returns empty |
| structure migration complete | workspace root | `test -d apps/web` fails, `pnpm-workspace.yaml` includes `examples/*`, root `tsconfig.json` references `examples/hello-chat` and `examples/kitchen-sink` |

## Definition of Done

Wave 1.k correction is complete when all verification gates above pass and Wave 1.k docs/changelog entries are updated.
