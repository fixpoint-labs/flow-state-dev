# Wave 1.k Journal - Correction Execution

## Summary

Executed the authoritative correction in `/Users/jakehoffner/Projects/flow-state-dev/corrections/WAVE_1K_CORRECTION.md` and replaced the prior Wave K implementation.

## What Changed

- Deleted `apps/web`.
- Added `examples/hello-chat` package with:
  - corrected flow (`src/flows/hello-chat/flow.ts`)
  - React usage sample (`src/app.tsx`)
  - flow tests (`test/flow.test.ts`)
  - package README
- Added `examples/kitchen-sink` package with:
  - corrected flow (`src/flows/kitchen-sink/flow.ts`)
  - extracted blocks (`src/flows/kitchen-sink/blocks/*`)
  - shared schemas (`src/flows/kitchen-sink/schemas.ts`)
  - client projection schemas (`src/client-schemas.ts`)
  - React usage sample (`src/app.tsx`)
  - flow + block tests (`test/flow.test.ts`, `test/blocks.test.ts`)
  - package README

## Runtime/Test Infrastructure Adjustments

- Enabled persisted scope resources in execution context:
  - `packages/server/src/context/createExecutionContext.ts`
  - session/user/project handles now expose configured resource registries backed by stores.
- Enabled resource-backed projections in session-state route:
  - `packages/server/src/routes/http-handlers.ts`
- Emitted `fsd:block_output` items from block execution runtime:
  - `packages/server/src/execution/executeBlock.ts`
- Fixed router selection for sequencer routes with `.then` (thenable-assimilation edge):
  - `packages/core/src/blocks/router.ts`
- Extended test seeding model to nested scope seeds (`state` + `resources`):
  - `packages/testing/src/runtime/createTestContext.ts`
  - `packages/testing/src/test-utilities/testFlow.ts`
  - `packages/testing/src/test-utilities/types.ts`
- Updated server tests for new block-output behavior:
  - `packages/server/test/execution.test.ts`

## Workspace/Docs Updates

- Updated workspace package discovery: `pnpm-workspace.yaml` now includes `examples/*`.
- Updated root TS project refs: `tsconfig.json` now references `examples/hello-chat` and `examples/kitchen-sink`.
- Updated onboarding and changelog docs to reference `examples/*` instead of `apps/web`.

## Verification Run

- `pnpm --filter @flow-state-dev/example-hello-chat typecheck` passed
- `pnpm --filter @flow-state-dev/example-hello-chat test` passed
- `pnpm --filter @flow-state-dev/example-kitchen-sink typecheck` passed
- `pnpm --filter @flow-state-dev/example-kitchen-sink test` passed
- `pnpm --filter @flow-state-dev/server test` passed
- `pnpm --filter @flow-state-dev/testing test` passed
- `grep -R "as any" examples/` returned no matches
- `grep -R "as FlowInstance" examples/` returned no matches
- `grep -R "PartRenderer\|\.parts" examples/` returned no matches
