/**
 * Lab stand-in for a core `evaluator` block.
 *
 *   evaluator           — state + questions (choice/score/boolean) → answers
 *   typesafeEvaluate    — alias of evaluator
 *   systemOneRouter     — choice + confidence-gated dispatch (composition)
 *   createSystemOneIndexCapability — index-time facets on evaluator answers
 *   createSystemOneSkillClassifier — optional skill-activator tier 3
 *   createSystemOneMemoryDecision — sketch: optional memory classifier
 *
 * Prefer AI SDK `experimental_evaluate` (Gateway / Jev) when the model
 * is evaluation-capable; fall back to System 2 structured output when
 * it is not. Not a published package. No OpenRouter Decisions client.
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
  hasSystem2Credentials,
  isEvaluationCapable,
  type EvaluateMode,
} from "./capability";
export { asTypeSafeState, runEvaluate, runTypeSafeDecision } from "./run-evaluate";
export type { RunEvaluateOptions } from "./run-evaluate";
export {
  formatSystem2Prompt,
  structuredAnswersSchema,
  structuredToAnswers,
  system2Evaluate,
  type GenerateStructuredFn,
  type StructuredAnswers,
  type System2EvaluateOptions,
} from "./system-2";
export { fromSdkResult, toSdkQuestions } from "./sdk-map";
export {
  DEFAULT_EVALUATE_MODEL,
  DEFAULT_SYSTEM2_MODEL,
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
