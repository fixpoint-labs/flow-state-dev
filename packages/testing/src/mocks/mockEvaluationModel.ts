/**
 * A scripted evaluation model for testing `evaluator` blocks without a
 * provider.
 *
 * Pass it as an evaluator's `model`. It returns the scripted answers from
 * every call and records each call on `calls`, so tests can assert how many
 * provider calls a run made. An answer's `confidence` is reported the way Jev
 * reports it (in provider metadata), so the evaluator's own mapping decides
 * where it lands; leave it out to model a provider that reports none.
 *
 * Failure modes:
 * - `error`: every call rejects with it (a provider failure);
 * - `hold: true`: every call stays pending until its abort signal fires, then
 *   rejects with the abort reason (a request cancelled mid-call);
 * - a malformed result: script answers that do not match the questions (one
 *   missing, a distribution that does not sum) and the SDK rejects them.
 */
import type { EvaluationModel, EvaluationQuestionType } from "@flow-state-dev/core/types";

/** One scripted answer, in the SDK's shape, plus an optional reported confidence. */
export type MockEvaluationAnswer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "score"; score: number; probabilities?: Record<string, number>; confidence?: number }
  | { type: "boolean"; probability: number; confidence?: number };

/** What one call to the mock received. */
export type MockEvaluationCall = {
  state: unknown;
  questions: Record<string, unknown>;
  abortSignal?: AbortSignal;
};

/** Options for {@link mockEvaluationModel}. */
export type MockEvaluationModelOptions = {
  /** Answers returned from every call, keyed by question id. */
  answers?: Record<string, MockEvaluationAnswer>;
  /** Reported token usage. Defaults to 10 input and 1 output token. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Model id. Defaults to `"mock-evaluation"`. */
  modelId?: string;
  /** Provider id. Defaults to `"mock.evaluation"`. */
  provider?: string;
  /** Question types the model answers. Defaults to all three. */
  supportedQuestionTypes?: EvaluationQuestionType[];
  /** Reject every call with this error. */
  error?: Error;
  /** Hold every call pending until its abort signal fires. */
  hold?: boolean;
};

/** An evaluation model that records its calls. */
export type MockEvaluationModel = EvaluationModel & {
  /** Every call made to the model, in order. */
  readonly calls: MockEvaluationCall[];
};

/**
 * Build a scripted evaluation model.
 *
 * @example
 * const model = mockEvaluationModel({
 *   answers: {
 *     team: { type: "choice", choice: "billing", confidence: 0.94 },
 *     urgent: { type: "boolean", probability: 0.2 },
 *   },
 * });
 * const triage = evaluator({ name: "triage", model, questions });
 * // ...run it...
 * expect(model.calls).toHaveLength(1);
 */
export function mockEvaluationModel(options: MockEvaluationModelOptions = {}): MockEvaluationModel {
  const calls: MockEvaluationCall[] = [];
  const model = {
    specificationVersion: "v4",
    provider: options.provider ?? "mock.evaluation",
    modelId: options.modelId ?? "mock-evaluation",
    supportedQuestionTypes: options.supportedQuestionTypes ?? ["choice", "score", "boolean"],
    calls,
    async doEvaluate(call: MockEvaluationCall) {
      calls.push(call);
      if (options.error !== undefined) throw options.error;
      if (options.hold === true) {
        await new Promise<never>((_resolve, reject) => {
          const signal = call.abortSignal;
          if (signal === undefined) return;
          const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      const answers: Record<string, unknown> = {};
      const confidence: Record<string, number> = {};
      for (const [id, scripted] of Object.entries(options.answers ?? {})) {
        const { confidence: reported, ...answer } = scripted;
        answers[id] = answer;
        if (reported !== undefined) confidence[id] = reported;
      }
      return {
        answers,
        usage: options.usage ?? { inputTokens: 10, outputTokens: 1 },
        warnings: [],
        providerMetadata: Object.keys(confidence).length > 0 ? { typesafe: { confidence } } : undefined,
      };
    },
  };
  return model as unknown as MockEvaluationModel;
}
