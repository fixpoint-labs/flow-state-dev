# Wave 1.k Changelog - Corrected Output

## Added

- `examples/hello-chat` workspace package:
  - `src/flows/hello-chat/flow.ts`
  - `src/app.tsx`
  - `test/flow.test.ts`
  - `README.md`
- `examples/kitchen-sink` workspace package:
  - `src/flows/kitchen-sink/flow.ts`
  - `src/flows/kitchen-sink/blocks/*`
  - `src/flows/kitchen-sink/schemas.ts`
  - `src/client-schemas.ts`
  - `src/app.tsx`
  - `test/flow.test.ts`
  - `test/blocks.test.ts`
  - `README.md`

## Changed

- `pnpm-workspace.yaml`: added `examples/*` workspace glob.
- `tsconfig.json`: replaced `apps/web` reference with `examples/hello-chat` and `examples/kitchen-sink` references.
- Runtime/testing support for corrected examples:
  - `packages/server/src/context/createExecutionContext.ts` (configured scope resources)
  - `packages/server/src/routes/http-handlers.ts` (resource-backed projection context)
  - `packages/server/src/execution/executeBlock.ts` (block-output item emission)
  - `packages/core/src/blocks/router.ts` (sequencer-route selection safety)
  - `packages/testing/src/runtime/createTestContext.ts` (resource seed-aware test flow)
  - `packages/testing/src/test-utilities/testFlow.ts` (nested scope seed support)
  - `packages/testing/src/test-utilities/types.ts` (seed type model updates)
- Updated server parity assertion for new block-output behavior:
  - `packages/server/test/execution.test.ts`

## Removed

- Deleted `apps/web` entirely.

## Validation Summary

- Example package typecheck/test gates passed for both examples.
- Server and testing package suites passed after runtime/test-harness corrections.
- Legacy/cast scans over `examples/` returned no matches for:
  - `as any`
  - `as FlowInstance`
  - `PartRenderer` / `.parts`
