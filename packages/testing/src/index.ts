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
  TestStateSeed,
  TestTargetSeed,
  WorkTrace
} from "./test-utilities/types";

export { snapshotTrace, type SnapshotTrace } from "./snapshot/snapshotTrace";

export {
  mockGenerator,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep
} from "./mocks/mockGenerator";

export const testingPackageMarker = "@flow-state-dev/testing";
