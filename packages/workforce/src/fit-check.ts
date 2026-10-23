/**
 * The one fit check: whether a worker's description fits the work, asked as
 * one choice over described candidates and answered with a pick and the
 * confidence the model reported, if any.
 *
 * Its two callers ask it different candidates, and read its answer their own
 * way:
 *
 * - **Best fit** (`best-fit.ts`) asks it the delegates, and the coordinator
 *   when it offers itself, about a user's message, and reads the pick through
 *   its ladder.
 * - **The lead vet** (`projects/lead-fit.ts`) asks it about the lead a worker
 *   chose for a workstream, with two more choices beside it, and refuses the
 *   open only on one of them.
 *
 * The call is an evaluator on the model. A gateway serves most model ids as
 * language models only, so when the evaluator fails on a model string the
 * check asks the same question once more as a language model. When that fails
 * too, or the model is no string, the check's answer is its failure, as a
 * value ({@link failedFitSchema}), never a throw: each caller decides what a
 * failed call means. A cancelled request is not a failed call, so its error
 * goes on up.
 */
import { choice, evaluator, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition, ChoiceAnswer, EvaluationInput, EvaluationModel } from "@flow-state-dev/core/types";
import { z } from "zod";

/** What a failed fit call leaves: the reason, as a value. */
export const failedFitSchema = z.object({ failed: z.string() });

/**
 * What an answered call leaves, as far as a caller reads it: the `worker`
 * question's {@link ChoiceAnswer}, its choice unchecked (anything; the caller
 * checks it against its candidates) and its confidence only when the model
 * reported one.
 */
const answeredFitSchema = z.object({
  answers: z.object({
    worker: z.object({
      choice: z.unknown(),
      confidence: z.number().finite().optional()
    } satisfies Record<keyof Pick<ChoiceAnswer, "choice" | "confidence">, z.ZodTypeAny>)
  })
});

/** What the check answered, read one way: its failure, or its pick and the confidence reported, if any. */
export type FitOutcome = { failed: string } | { choice: unknown; confidence?: number };

/**
 * Read what the check left: its failure, or what it chose and the confidence
 * it reported. A confidence outside [0, 1] is none, as core's cascading gate
 * reads it; a confidence is never made up.
 */
export function fitOutcome(answer: unknown): FitOutcome {
  const failed = failedFitSchema.safeParse(answer);
  if (failed.success) return failed.data;
  const answered = answeredFitSchema.safeParse(answer);
  if (!answered.success) return { choice: undefined };
  const { choice: picked, confidence } = answered.data.answers.worker;
  return confidence === undefined || confidence < 0 || confidence > 1 ? { choice: picked } : { choice: picked, confidence };
}

/** Whether the check's answer is its failure. */
const isFailedFit = (answer: unknown) => failedFitSchema.safeParse(answer).success;

/** Turn a failed call into a value the caller reads, for `.rescue([{ block }])`. */
function fitCallFailed(name: string): BlockDefinition<z.ZodUnknown, typeof failedFitSchema> {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: failedFitSchema,
    execute: (error: unknown, ctx) => {
      if (ctx.signal.aborted) throw error;
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** What one fit check is built from. */
export interface FitCheckOptions<TInput> {
  /**
   * The check's evaluator block, which a scripted model resolves by name; its
   * language-model ask is `<name>-ask`.
   */
  name: string;
  /** The model it runs on: a model string the app's resolver turns into an evaluation model, or one. */
  model: string | EvaluationModel;
  inputSchema: z.ZodType<TInput>;
  /** The one question, asked over the candidates. */
  question: string;
  /** The candidates, each keyed by what the check answers and described by what it is picked by. */
  candidates: (input: TInput) => Record<string, string>;
  /** The work, as the evaluator reads it. */
  state: (input: TInput) => EvaluationInput;
  /** The work, as the language-model ask reads it. */
  work: (input: TInput) => string;
  /** Run with the evaluator's failure before the check asks again as a language model. */
  onEvaluationFailed?: BlockDefinition<typeof failedFitSchema, z.ZodTypeAny>;
}

/**
 * Build one fit check. Its answer is the evaluator's (`{ answers: { worker } }`)
 * or a failure ({@link failedFitSchema}); read it with {@link fitOutcome}.
 */
export function defineFitCheck<TInput>(options: FitCheckOptions<TInput>) {
  const { name, model, inputSchema, question, candidates } = options;
  const evaluate = evaluator({
    name,
    model,
    inputSchema,
    state: options.state,
    questions: (input: TInput) => ({ worker: choice(question, candidates(input)) })
  }).rescue([{ block: fitCallFailed(`${name}-evaluation-failed`) }]);

  const checked = sequencer({ name: `${name}-check`, inputSchema }).step(evaluate);
  if (typeof model !== "string") return checked;

  const ask = generator({
    name: `${name}-ask`,
    model,
    inputSchema,
    outputSchema: z.object({ worker: z.string() }),
    itemVisibility: { client: false, history: false },
    // Only the check's own model picks: no coercion pass on another model.
    repair: { coerce: false },
    prompt: (input: TInput) =>
      [
        question,
        "Answer with the key of exactly one option below, as `worker`.",
        "",
        "Options:",
        ...Object.entries(candidates(input)).map(([key, pickBy]) => `- ${key}: ${pickBy}`)
      ].join("\n"),
    user: options.work
  })
    .connectInput((_failed: unknown, ctx) => inputSchema.parse(ctx.parent?.input))
    .connectOutput((asked: { worker: string }) => ({ answers: { worker: { choice: asked.worker } } }))
    .rescue([{ block: fitCallFailed(`${name}-ask-failed`) }]);

  return (options.onEvaluationFailed === undefined ? checked : checked.tapIf(isFailedFit, options.onEvaluationFailed)).stepIf(
    isFailedFit,
    ask
  );
}
