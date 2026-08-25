/**
 * Testing entry point for `@flow-state-dev/engine`. Imported as
 * `@flow-state-dev/engine/testing`. Hosts conformance harnesses, fixture
 * builders, and race-staging helpers for store-interface and route tests.
 */
export {
  createTraceStoreConformanceTests,
  makeTraceEvent,
  type CreateTraceStoreConformanceTestsOptions,
  type MakeTraceEventOptions
} from "./stores/testing/trace-store-conformance";
export {
  createRequestStoreConformanceTests,
  makeRequestStreamEvent,
  makeRequestCompletedEvent,
  type CreateRequestStoreConformanceTestsOptions
} from "./stores/testing/request-store-conformance";
export {
  createContentStoreConformanceTests,
  createResourceStateStoreConformanceTests,
  type CreateContentStoreConformanceTestsOptions,
  type CreateResourceStateStoreConformanceTestsOptions
} from "./stores/testing/resource-store-conformance";
export {
  createScopeStoreConformanceTests,
  type CreateScopeStoreConformanceTestsOptions,
  type ScopeStoreUnderTest
} from "./stores/testing/scope-store-conformance";
export {
  gateNextStateRead,
  StateReadGateTimeoutError,
  type StateReadGate
} from "./stores/testing/state-read-gate";
