# Wave 1.j Changelog

## Summary

- Implemented `@flow-state-dev/testing` runtime harness (`createTestContext`) with seeded in-memory scope state and state-change capture.
- Implemented canonical testing utilities: `testBlock`, `testSequencer`, `testRouter`, `testFlow`, and `testItems`.
- Implemented snapshot trace utility `snapshotTrace` for deterministic regression assertions.
- Implemented scripted generator mocking utility `mockGenerator`.
- Expanded package exports and added package-level Wave J coverage.
- Updated testing package README with public API usage guidance.

## Deliverable Mapping

| Deliverable | Evidence |
|---|---|
| Test harness context/stores | `packages/testing/src/runtime/createTestContext.ts` |
| Block/sequencer/router testing helpers | `packages/testing/src/test-utilities/testBlock.ts`, `packages/testing/src/test-utilities/testSequencer.ts`, `packages/testing/src/test-utilities/testRouter.ts` |
| Flow testing helper | `packages/testing/src/test-utilities/testFlow.ts` |
| Item assertions + snapshot tracing | `packages/testing/src/test-utilities/testItems.ts`, `packages/testing/src/snapshot/snapshotTrace.ts` |
| Generator mocks | `packages/testing/src/mocks/mockGenerator.ts` |
| Testing package API exports + tests | `packages/testing/src/index.ts`, `packages/testing/test/index.test.ts`, `packages/testing/test/test-utilities.test.ts`, `packages/testing/test/mock-generator.test.ts` |
