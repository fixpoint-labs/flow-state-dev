// ---------------------------------------------------------------------------
// @flow-state-dev/knowledge-base — incubation lab barrel (FIX-813).
//
// Incubated, not published: an OKF v0.1 interchange adapter + a thin
// knowledgeBase capability over the resource graph, validated against the
// example flow in `./flow` before any public-package graduation.
// ---------------------------------------------------------------------------

export {
  conceptCollection,
  conceptStateSchema,
  conceptIdFromPath,
  type ConceptState,
} from "./concepts";
export { createKnowledgeBaseCapability } from "./capability";
export {
  parseOkfBundle,
  importOkf,
  exportOkf,
  OKF_VERSION,
  DEFAULT_EDGE_TYPE,
  DEFAULT_CONCEPT_TYPE,
  RESERVED_FILENAMES,
  type ImportResult,
  type ExportResult,
  type OkfConcept,
  type ParsedOkfBundle,
} from "./okf/index";
export { default as knowledgeFlow } from "./flow";
