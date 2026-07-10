// ---------------------------------------------------------------------------
// OKF interchange adapter barrel (FIX-813).
//
// The producer/consumer boundary at the FSD edge: parse + import an external
// OKF bundle into a concept collection, and export a collection back to a
// portable OKF v0.1 bundle. Interchange-only — there is no single-file-backed
// collection variant in v0.
// ---------------------------------------------------------------------------

export { parseOkfBundle } from "./parse";
export { importOkf, type ImportResult } from "./import";
export { exportOkf, type ExportResult } from "./export";
export {
  OKF_VERSION,
  DEFAULT_EDGE_TYPE,
  DEFAULT_CONCEPT_TYPE,
  RESERVED_FILENAMES,
  type OkfConcept,
  type ParsedOkfBundle,
} from "./types";
