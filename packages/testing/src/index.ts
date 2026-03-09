/**
 * Public testing utilities for deterministic block/flow assertions.
 */
export { createTestContext, type CreateTestContextOptions } from "./runtime/createTestContext";

export { testBlock } from "./test-utilities/testBlock";
export { testSequencer } from "./test-utilities/testSequencer";
export { testRouter } from "./test-utilities/testRouter";
export { testFlow } from "./test-utilities/testFlow";
export { testItems } from "./test-utilities/testItems";

export type {
  StateChange,
  StepTrace,
  TestBlockOptions,
  TestBlockResult,
  TestFlowOptions,
  TestFlowResult,
  TestRouterResult,
  TestSequencerResult,
  TestSequencerSeed,
  TestStateSeed,
  TestTargetSeed,
  WorkTrace
} from "./test-utilities/types";

export { snapshotTrace, type SnapshotTrace } from "./snapshot/snapshotTrace";

export {
  createMockModelResolver,
  mockGenerator,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep,
  type UnmockedGeneratorPolicy
} from "./mocks/mockGenerator";

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
} from "./eval";

export const testingPackageMarker = "@flow-state-dev/testing";
