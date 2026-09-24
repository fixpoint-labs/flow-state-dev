/**
 * The evaluation seam: the one module that calls the AI SDK's
 * `experimental_evaluate` and imports its experimental evaluation types.
 *
 * The SDK marks its evaluation contract as one that may change in patch
 * releases. Everything downstream (the `evaluator` block, the trace, the
 * consumers of its answers) reads FSD's own types from
 * `types/evaluation.ts`; when the SDK's shape moves, this file absorbs it.
 *
 * Contract:
 * - exactly one provider call: the SDK's transient retry is off
 *   (`maxRetries: 0`) and nothing here retries or falls back;
 * - the request's abort signal reaches the provider call;
 * - an answer carries `confidence` only when the model reported one, read
 *   from Jev's `providerMetadata.typesafe.confidence[questionId]`. No number
 *   is ever defaulted, and a boolean's `probability` is never copied into it.
 */
import { experimental_evaluate, type Experimental_EvaluationModel } from "ai";
import type { ModelIdentity } from "@flow-state-dev/contracts";
import type {
  EvaluationInput,
  EvaluationModel,
  EvaluatorAnswer,
  EvaluatorAnswers,
  EvaluatorQuestions,
} from "../types/evaluation";
import type { GeneratorModelUsage } from "../types/model";

type SdkEvaluationModel = Exclude<Experimental_EvaluationModel, string>;

/** Options for {@link runEvaluation}. */
export interface RunEvaluationOptions {
  model: EvaluationModel;
  state: EvaluationInput;
  questions: EvaluatorQuestions;
  signal?: AbortSignal;
  /**
   * The model the author asked for: the block's model string, or
   * `provider/modelId` for an instance. Recorded as `requested` on the
   * identity when the model reports a different id.
   */
  requested: string;
}

/** What one evaluation call produced, in FSD's shapes. */
export interface EvaluationCallResult {
  answers: EvaluatorAnswers;
  /** Token usage, when the provider reported any. */
  usage?: GeneratorModelUsage;
  /** The model that actually answered. */
  identity: ModelIdentity;
}

/**
 * Read Jev's per-question confidence from provider metadata. Returns the
 * map only when it is a plain object; individual values are checked by the
 * caller.
 */
function reportedConfidence(
  providerMetadata: Record<string, Record<string, unknown>> | undefined
): Record<string, unknown> | undefined {
  const confidence = providerMetadata?.typesafe?.confidence;
  return typeof confidence === "object" && confidence !== null
    ? (confidence as Record<string, unknown>)
    : undefined;
}

/**
 * Copy one SDK answer into FSD's answer type. Only the fields the SDK
 * defines for that answer type are copied; `confidence` is added only when
 * the model reported a finite number for this question.
 */
function toFsdAnswer(raw: Record<string, unknown>, confidence: unknown): EvaluatorAnswer {
  let answer: EvaluatorAnswer;
  switch (raw.type) {
    case "choice":
      answer = { type: "choice", choice: raw.choice as string };
      break;
    case "score":
      answer = { type: "score", score: raw.score as number };
      break;
    default:
      answer = { type: "boolean", probability: raw.probability as number };
  }
  if (answer.type !== "boolean" && raw.probabilities !== undefined) {
    answer.probabilities = raw.probabilities as Record<string, number>;
  }
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    answer.confidence = confidence;
  }
  return answer;
}

/**
 * Ask an evaluation model the questions about one state. One provider call;
 * the SDK validates the model's result (one answer per question, known
 * options, distributions that sum) and throws rather than returning a
 * partial answer set.
 */
export async function runEvaluation(options: RunEvaluationOptions): Promise<EvaluationCallResult> {
  const result = await experimental_evaluate({
    model: options.model as unknown as SdkEvaluationModel,
    state: options.state,
    questions: options.questions,
    maxRetries: 0,
    abortSignal: options.signal,
  });

  const confidence = reportedConfidence(
    result.providerMetadata as Record<string, Record<string, unknown>> | undefined
  );
  const answers: EvaluatorAnswers = {};
  for (const [id, raw] of Object.entries(result.answers)) {
    answers[id] = toFsdAnswer(raw as Record<string, unknown>, confidence?.[id]);
  }

  const { inputTokens, outputTokens } = result.usage;
  const usage: GeneratorModelUsage | undefined =
    inputTokens === undefined && outputTokens === undefined
      ? undefined
      : {
          promptTokens: inputTokens ?? 0,
          completionTokens: outputTokens ?? 0,
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        };

  const actual = result.response.modelId;
  const identity: ModelIdentity =
    actual === options.requested ? { actual } : { actual, requested: options.requested };

  return { answers, usage, identity };
}
