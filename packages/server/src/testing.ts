/**
 * Testing entry point for `@flow-state-dev/server`.
 *
 * Imported as `@flow-state-dev/server/testing`. Hosts conformance harnesses
 * for the store interfaces — currently `TraceStore`, with future suites
 * (request, session, content) plugging in alongside.
 */
export {
  createTraceStoreConformanceTests,
  type CreateTraceStoreConformanceTestsOptions
} from "./stores/testing/trace-store-conformance";
