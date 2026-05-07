/**
 * Testing entry point for `@flow-state-dev/server`. Imported as
 * `@flow-state-dev/server/testing`. Hosts conformance harnesses and
 * fixture builders for store-interface tests.
 */
export {
  createTraceStoreConformanceTests,
  makeTraceEvent,
  type CreateTraceStoreConformanceTestsOptions,
  type MakeTraceEventOptions
} from "./stores/testing/trace-store-conformance";
