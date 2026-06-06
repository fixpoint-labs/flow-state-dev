/**
 * Public testing utilities for deterministic block/flow assertions.
 */
export { createTestContext, type CreateTestContextOptions } from "./runtime/createTestContext";

export { testBlock } from "./test-utilities/testBlock";
export { testSequencer } from "./test-utilities/testSequencer";
export { testRouter } from "./test-utilities/testRouter";
export { testFlow } from "./test-utilities/testFlow";
export { testItems } from "./test-utilities/testItems";
export { runForTest } from "./test-utilities/runForTest";

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
  type MockGeneratorPredicateEntry,
  type MockGeneratorScriptEntry,
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

// Cross-pattern benchmark harness (FIX-614): sweeps a task suite across
// multiple subjects (patterns + baseline) and produces a comparative scorecard.
export {
  runBenchmark,
  comparePatterns,
  baselineSubject,
  defineBenchmark,
  buildBenchmarkReport,
  renderScorecard,
  estimateCostUsd,
} from "./benchmark";

export type {
  RunBenchmarkConfig,
  ComparePatternsConfig,
  SubjectCategoryStat,
  BenchmarkRanking,
  BenchmarkReport,
  BenchmarkRunResult,
  BenchmarkDefinition,
  BuildBenchmarkReportMeta,
} from "./benchmark";

// Benchmark contract types are defined in @flow-state-dev/core (shared with
// pattern adapters); re-exported here for single-import ergonomics.
export type {
  BenchmarkCategory,
  BenchmarkTask,
  BenchmarkSubject,
  BenchmarkAdapter,
  BenchmarkAdapterOptions,
  BenchmarkRegistry,
} from "@flow-state-dev/core";

// Note: conformance helpers (`createInboundTransportConformanceTests`,
// `createMockTransportHost`, etc.) live in `./transports/conformance` and
// import `vitest` at the top level. Re-exporting them from this index would
// make `import "@flow-state-dev/testing"` fail for non-test consumers
// (e.g. the CLI loading at runtime). They're available via the
// `@flow-state-dev/testing/conformance` subpath export instead.

export const testingPackageMarker = "@flow-state-dev/testing";
