/**
 * Future `@flow-state-dev/system-one` surface, incubated in this lab.
 *
 *   systemOneRouter     — intent + confidence-gated dispatch (the star)
 *   typesafeEvaluate    — low-level state + questions → answers
 *   systemOneChoice / systemOneScore / systemOneNoul — one-shot wrappers
 *   choice / score / noul — question builders
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
