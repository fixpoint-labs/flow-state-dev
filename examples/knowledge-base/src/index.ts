// ---------------------------------------------------------------------------
// @flow-state-dev/example-knowledge-base — reference-app barrel (FIX-813).
//
// A frozen reference app, not a published package: an OKF v0.1 interchange
// adapter + a thin knowledgeBase capability over the resource graph, exposed
// through the example flow in `./flow`. The living successor is the Knowledge
// Hub lab (`labs/knowledge-hub`), where OKF may later graduate to a package.
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
