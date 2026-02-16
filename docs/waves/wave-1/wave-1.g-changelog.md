# Wave 1.g Changelog

## Summary

- Added canonical server execution and error runtime primitives.
- Added retry merge/filter utilities and block-kind execution dispatch wrappers.
- Added rescue routing and work queue convergence utilities.
- Added request action runner with canonical lifecycle observer ordering and terminal request status updates.
- Added internal execution seam metadata and no-op interception hooks for middleware readiness.
- Added server unit coverage for execution/error/runtime seam behavior.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Error classes + normalization | `packages/server/src/errors/flow-error.ts`, `packages/server/src/errors/normalize-error.ts` |
| Retry engine | `packages/server/src/execution/retry.ts` |
| Block dispatch runtime | `packages/server/src/execution/executeBlock.ts`, `packages/server/src/execution/executeHandler.ts`, `packages/server/src/execution/executeGenerator.ts`, `packages/server/src/execution/executeSequencer.ts`, `packages/server/src/execution/executeRouter.ts` |
| Rescue + work convergence runtime | `packages/server/src/execution/rescue.ts`, `packages/server/src/execution/work-queue.ts` |
| Request action runner | `packages/server/src/execution/runAction.ts` |
| Internal execution seam metadata/no-op hooks | `packages/server/src/execution/types.ts`, `packages/server/src/execution/internal/seams.ts` |
| Execution export wiring | `packages/server/src/execution/index.ts`, `packages/server/src/index.ts` |
| Unit verification coverage | `packages/server/test/execution.test.ts`, `packages/server/test/index.test.ts` |
