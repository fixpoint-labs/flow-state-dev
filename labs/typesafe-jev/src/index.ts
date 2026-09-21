/**
 * Lab stand-in for a core `evaluator` block.
 *
 *   evaluator           — state + questions (choice/score/boolean) → answers
 *   typesafeEvaluate    — alias of evaluator
 *   cascadingRouter     — evaluate trees in code, confidence-gated edges
 *   systemOneRouter     — one-level choice + confidence-gated dispatch
 *   createSystemOneIndexCapability — index-time facets on evaluator answers
 *   createSystemOneSkillClassifier — optional skill-activator tier 3
 *   createSystemOneMemoryDecision — sketch: optional memory classifier
 *
 * Thin wrap of AI SDK `experimental_evaluate`. Prefer Jev. Accept any
 * evaluation-capable model string or `evaluationModel(...)` instance.
 * Not a published package. No OpenRouter Decisions. No generator+Zod shim.
 */

export {
  createAiSdkEvaluateClient,
  resolveEvaluateApiKey,
  type AiSdkEvaluateClientOptions,
  type EvaluateClient,
  type EvaluateFn,
  type EvaluateRequest,
  type TypeSafeDecisionsClient,
  type TypeSafeRequest,
} from "./client";
export { TypeSafeError, type TypeSafeErrorCode } from "./errors";
export {
  evaluator,
  jevDecide,
  typesafeEvaluate,
  type EvaluatorBlock,
  type EvaluatorConfig,
  type TypeSafeEvaluateBlock,
  type TypeSafeEvaluateConfig,
} from "./evaluate";
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
  systemOneBoolean,
  systemOneChoice,
  systemOneNoul,
  systemOneScore,
  type SystemOneBooleanConfig,
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
  CASCADING_AMBIGUOUS,
  DEFAULT_CASCADE_QUESTION,
  cascadeGateOpen,
  cascadingRouter,
  type CascadeBranch,
  type CascadeFork,
  type CascadeGate,
  type CascadeLeaf,
  type CascadeQuestion,
  type CascadingRouterConfig,
} from "./cascading-router";
export {
  CASCADING_FLOW_KIND,
  billingQueueLeaf,
  cascadeInputSchema,
  cascadeOutputSchema,
  createCascadingTriageFlow,
  createCascadingTriageRouter,
  escalateLeaf,
  reviewLeaf,
  techQueueLeaf,
  type CascadeInput,
  type CascadeOutput,
  type CascadingTriageOptions,
} from "./cascading-flow";
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
  MEMORY_KIND_NONE,
  MEMORY_KIND_QUESTION,
  MEMORY_SALIENCE_QUESTION,
  MEMORY_STORE_QUESTION,
  createSystemOneMemoryDecision,
  memoryDecisionInputSchema,
  memoryDecisionOutputSchema,
  type MemoryDecisionInput,
  type MemoryDecisionOutput,
  type SystemOneMemoryDecisionOptions,
} from "./memory-decision";
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
export {
  hasEvaluateCredentials,
  isEvaluationCapable,
  resolveEvaluateModel,
} from "./capability";
export { asTypeSafeState, runEvaluate, runTypeSafeDecision } from "./run-evaluate";
export type { RunEvaluateOptions } from "./run-evaluate";
export { fromSdkResult, toSdkQuestions } from "./sdk-map";
export {
  DEFAULT_EVALUATE_MODEL,
  DEFAULT_TYPESAFE_MODEL,
  answerSchema,
  answersSchema,
  boolean,
  booleanAnswerSchema,
  booleanQuestionSchema,
  choice,
  choiceAnswerSchema,
  choiceQuestionSchema,
  evaluateInputSchema,
  evaluateOutputSchema,
  isBooleanAnswer,
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
  truthProbability,
  usableConfidence,
  type AnswerFor,
  type AnswersFor,
  type BooleanAnswer,
  type BooleanQuestion,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type EvaluatePath,
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
