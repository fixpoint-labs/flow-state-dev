/**
 * Future `@flow-state-dev/system-one` surface, incubated in this lab.
 *
 *   systemOneRouter     — intent + confidence-gated dispatch (the star)
 *   typesafeEvaluate    — low-level state + questions → answers
 *   systemOneChoice / systemOneScore / systemOneNoul — one-shot wrappers
 *   choice / score / noul — question builders
 *   createSystemOneIndexCapability — index-time classify + deterministic facet search
 *   createSystemOneSkillClassifier — optional Jev drop-in for skill-activator tier 3
 */

export {
  createOpenRouterDecisionsClient,
  resolveOpenRouterApiKey,
  type OpenRouterDecisionsClientOptions,
  type TypeSafeDecisionsClient,
  type TypeSafeRequest,
} from "./client";
export { TypeSafeError, type TypeSafeErrorCode } from "./errors";
export { jevDecide, typesafeEvaluate, type TypeSafeEvaluateConfig } from "./evaluate";
export {
  createTicketTriageFlow,
  FLOW_KIND,
  ticketInputSchema,
  triageOutputSchema,
  type TicketInput,
  type TicketTriageOptions,
  type TriageOutput,
} from "./flow";
export {
  chatPipeline,
  createModeRouter,
  createSystemOneDemoFlow,
  modeInputSchema,
  modeOutputSchema,
  planPipeline,
  reviewPipeline,
  SYSTEM_ONE_FLOW_KIND,
  type ModeInput,
  type ModeOutput,
  type SystemOneDemoOptions,
} from "./mode-flow";
export {
  systemOneChoice,
  systemOneNoul,
  systemOneScore,
  type SystemOneChoiceConfig,
  type SystemOneNoulConfig,
  type SystemOneScoreConfig,
} from "./oneshot";
export { TICKET_QUESTIONS, type TicketQuestions } from "./questions";
export {
  DEFAULT_MIN_CONFIDENCE,
  routeByChoice,
  type RouteByChoiceOptions,
  type RouteDecision,
} from "./route";
export {
  SYSTEM_ONE_DEFAULT_ROUTE,
  SYSTEM_ONE_ROUTE_QUESTION,
  systemOneRouter,
  type SystemOneDescribedRoute,
  type SystemOneRouteEntry,
  type SystemOneRouteMap,
  type SystemOneRouterConfig,
} from "./router";
export {
  FACET_KIND_QUESTION,
  FACET_STATUS_QUESTION,
  FACET_TOPIC_QUESTION,
  FACET_URGENCY_QUESTION,
  INDEX_FACET_QUESTIONS,
  facetsFromAnswers,
  filterByFacets,
  hashIndexedContent,
  needsReindex,
  stripIndexedPrefix,
  type FacetQuery,
  type IndexedHit,
} from "./facets";
export {
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  classifyOnWrite,
  classifyQuery,
  createSearchIndexedDocumentsTool,
  reindexIndexedDocuments,
  searchIndexedDocuments,
  type ClassifyQueryInput,
  type ClassifyQueryOutput,
  type IndexBlockOptions,
  type IngestInput,
  type IngestOutput,
  type ReindexInput,
  type ReindexOutput,
  type SearchInput,
  type SearchOutput,
} from "./index-blocks";
export {
  createSystemOneIndexCapability,
  systemOneIndexTools,
  type CreateSystemOneIndexCapabilityOptions,
  type SystemOneIndexCapability,
  type SystemOneIndexFns,
} from "./index-capability";
export {
  INDEXED_DOCS_FLOW_KIND,
  createIndexedDocsFlow,
  type IndexedDocsFlowOptions,
} from "./index-flow";
export {
  FACET_SCHEMA_VERSION,
  INDEXED_DOCS,
  documentKindSchema,
  documentStatusSchema,
  documentTopicSchema,
  documentUrgencySchema,
  indexedDocsCollection,
  indexedDocsResources,
  indexedDocumentFacetsSchema,
  indexedDocumentStateSchema,
  type DocumentKind,
  type DocumentStatus,
  type DocumentTopic,
  type DocumentUrgency,
  type IndexedDocumentFacets,
  type IndexedDocumentState,
} from "./indexed-docs-resource";
export {
  DEMO_SKILLS,
  SKILL_ACTIVATOR_FLOW_KIND,
  createSkillActivatorDemoFlow,
  createSystemOneSkillActivator,
  type SkillActivatorFlowOptions,
  type SystemOneSkillActivatorOptions,
} from "./skill-activator-flow";
export {
  SKILLS_COLLECTION_KEY,
  SYSTEM_ONE_SKILL_CONFIDENCE,
  SYSTEM_ONE_SKILL_NONE,
  SYSTEM_ONE_SKILL_QUESTION,
  createSystemOneSkillClassifier,
  demoSkillsCollection,
  listSkillsForChoice,
  skillsCatalogAnchor,
  type SkillCatalogEntry,
  type SystemOneSkillClassifierOptions,
} from "./skill-classifier";
export { asTypeSafeState, runTypeSafeDecision } from "./run-decision";
export {
  DEFAULT_TYPESAFE_MODEL,
  OPENROUTER_DECISIONS_URL,
  answerSchema,
  answersSchema,
  choice,
  choiceAnswerSchema,
  choiceQuestionSchema,
  evaluateInputSchema,
  evaluateOutputSchema,
  isChoiceAnswer,
  isNoulAnswer,
  isScoreAnswer,
  noul,
  noulAnswerSchema,
  noulQuestionSchema,
  questionSchema,
  questionsSchema,
  score,
  scoreAnswerSchema,
  scoreQuestionSchema,
  stateSchema,
  type AnswerFor,
  type AnswersFor,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type NoulAnswer,
  type NoulQuestion,
  type ScoreAnswer,
  type ScoreQuestion,
  type TypeSafeAnswer,
  type TypeSafeAnswers,
  type TypeSafeEvaluateInput,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestion,
  type TypeSafeQuestions,
  type TypeSafeState,
  type TypeSafeUsage,
} from "./schemas";
