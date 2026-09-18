/**
 * POC lab: TypeSafe / Jev as an FSD handler block, via OpenRouter Decisions.
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
export { TICKET_QUESTIONS, type TicketQuestions } from "./questions";
export {
  DEFAULT_MIN_CONFIDENCE,
  routeByChoice,
  type RouteByChoiceOptions,
  type RouteDecision,
} from "./route";
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
