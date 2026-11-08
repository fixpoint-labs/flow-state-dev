/**
 * `@flow-state-dev/patterns/benchmark`: the pattern adapters, the default
 * registry, and the shared worker helper used to wire them.
 *
 * The adapters' types come from `@flow-state-dev/testing/benchmark`, which
 * patterns lists as an optional peer dependency: only this entry reads it.
 */
export {
  supervisorBenchmarkAdapter,
  planAndExecuteBenchmarkAdapter,
  parallelTasksBenchmarkAdapter,
  roundRobinBenchmarkAdapter,
  debateBenchmarkAdapter,
  routedSpecialistsBenchmarkAdapter,
} from "./adapters";
export { defaultBenchmarkRegistry } from "./registry";
export { sharedDefaultWorker } from "./sharedWorker";
