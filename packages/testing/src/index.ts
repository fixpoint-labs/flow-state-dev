/**
 * Public testing utilities for deterministic block/flow assertions.
 */
export { createTestContext, type CreateTestContextOptions } from "./runtime/createTestContext";

export { testBlock } from "./test-utilities/testBlock";
export { testFlow } from "./test-utilities/testFlow";
export { testItems } from "./test-utilities/testItems";
export { runForTest } from "./test-utilities/runForTest";
export { createReplayingRef, type ReplayingRef } from "./test-utilities/replayingRef";

export type {
  StateChange,
  StepTrace,
  TestBlockOptions,
  TestBlockResult,
  TestFlowOptions,
  TestFlowResult,
  TestSequencerSeed,
  TestStateSeed,
  TestTargetSeed,
  SideChainTrace
} from "./test-utilities/types";

export { snapshotTrace, type SnapshotTrace } from "./snapshot/snapshotTrace";

export {
  createMockModelResolver,
  mockGenerator,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep,
  type MockGeneratorPredicateEntry,
  type MockGeneratorScriptEntry,
  type MockToolResult,
  type UnmockedGeneratorPolicy,
  type UnmockedDefault
} from "./mocks/mockGenerator";

export {
  mockEvaluationModel,
  type MockEvaluationAnswer,
  type MockEvaluationAnswers,
  type MockEvaluationCall,
  type MockEvaluationModel,
  type MockEvaluationModelOptions
} from "./mocks/mockEvaluationModel";

export {
  evalBlock,
  evalFlow,
  exactMatch,
  schemaValid,
  contains,
  jsonPath,
  threshold,
  custom,
  allOf,
  anyOf,
  analyzerScorer,
  loadDataset,
  fromCsv,
  buildReport,
} from "./eval";

export type {
  Scorer,
  ScoreResult,
  EvalCase,
  EvalBlockConfig,
  EvalFlowConfig,
  EvalCaseResult,
  ScorerSummary,
  EvalReport,
  LoadDatasetOptions,
  CsvMapping,
  AnalyzerScorerConfig,
  ScoreMapping,
} from "./eval";

// The cross-pattern benchmark harness is on `@flow-state-dev/testing/benchmark`.
//
// Note: conformance helpers (`createInboundTransportConformanceTests`,
// `createMockTransportHost`, etc.) live in `./transports/conformance` and
// import `vitest` at the top level. Re-exporting them from this index would
// make `import "@flow-state-dev/testing"` fail for non-test consumers
// (e.g. the CLI loading at runtime). They're available via the
// `@flow-state-dev/testing/conformance` subpath export instead.
