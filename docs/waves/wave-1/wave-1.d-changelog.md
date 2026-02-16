# Wave 1.d Changelog

## Summary

- Added core flow runtime API (`defineFlow`) and flow barrel exports.
- Added flow-level tools merge/wiring so generator action blocks receive flow + instance tool defaults/hooks.
- Expanded core tests with focused `defineFlow` and tool lifecycle/default coverage.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| `defineFlow` runtime implementation | `packages/core/src/flow/defineFlow.ts` |
| Flow barrel export | `packages/core/src/flow/index.ts` |
| Core export wiring for flow runtime/types | `packages/core/src/index.ts`, `packages/core/src/types/flow.ts` |
| Flow-level tools wired into generator execution | `packages/core/src/flow/defineFlow.ts`, `packages/core/src/blocks/generator.ts` |
| Unit tests for Wave 1.d behavior | `packages/core/test/flow.test.ts`, `packages/core/test/blocks.test.ts` |
