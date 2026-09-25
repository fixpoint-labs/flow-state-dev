/**
 * Memory's capture question and the helper that builds an evaluator for it.
 *
 * Capture can put an evaluator in front of the observer: before the observer
 * reads a turn, the evaluator answers one question, "is anything in these new
 * messages worth remembering?". `remember` runs the observer as usual; `skip`
 * writes nothing and marks the messages read.
 *
 * Memory publishes the question (`captureQuestions`) and a one-line helper
 * (`captureEvaluator(model)`) that passes the app's model, untouched, to
 * core's `evaluator()`. Memory never names, defaults or resolves a model:
 * core resolves a model string when the block runs, through the flow's
 * model resolver.
 */
import { choice, evaluator } from '@flow-state-dev/core'
import type { BlockDefinition, ChoiceAnswer, EvaluationModel } from '@flow-state-dev/core'
import type { ZodTypeAny } from 'zod'

/**
 * The one question capture asks, keyed `capture`, with options `remember`
 * and `skip`. Pass it as an evaluator's `questions` (or spread it into a
 * larger set) when building the block by hand. Keep the key and both
 * option names: capture reads them.
 */
export const captureQuestions = {
  capture: choice(
    'Do these new conversation messages contain anything worth remembering beyond this turn? ' +
      'Worth remembering: facts about the user or people they mention (name, job, location, ' +
      'relationships), preferences or beliefs the user stated, goals, constraints, corrections ' +
      'of something said earlier, or a task the user asked for.',
    {
      remember:
        'At least one message states something worth storing: a fact about the user or ' +
        'someone they mention, a stated preference, a goal or constraint, a correction, or a task.',
      skip:
        'Nothing worth storing: small talk, acknowledgements ("ok", "thanks"), retries, ' +
        'or generic content that says nothing about the user or their task.',
    },
  ),
}

/** The question set capture reads: `{ capture: choice(remember | skip) }`. */
export type CaptureQuestions = typeof captureQuestions

/** What the capture evaluator answers: `remember` or `skip`. */
export type CaptureChoice = 'remember' | 'skip'

/**
 * The evaluator block `system({ evaluator })` accepts: any block that takes
 * the window text and answers `capture` with `remember` or `skip`. Built by
 * {@link captureEvaluator}, or by hand with core's `evaluator()` and
 * {@link captureQuestions}. Extra questions are allowed and ignored.
 */
export type CaptureEvaluatorBlock = BlockDefinition<
  ZodTypeAny,
  ZodTypeAny,
  string,
  { answers: { capture: ChoiceAnswer<CaptureChoice> } }
>

/** The name the block built by {@link captureEvaluator} carries in traces. */
export const CAPTURE_EVALUATOR_NAME = 'memory/capture-evaluator'

/**
 * Build core's evaluator block asking memory's capture question on the model
 * the app names. Pass the result as `system({ evaluator })`.
 *
 * The model is passed through untouched: a model string resolves when the
 * block runs, the same way the app's generator model strings do; a model
 * instance (e.g. `openai.evaluationModel("gpt-5.4-mini")`) is used as given.
 *
 * @example
 * const mem = system({
 *   model: 'openai/gpt-5.4-mini',
 *   working: true,
 *   evaluator: captureEvaluator('typesafe-ai/jev'),
 * })
 */
export function captureEvaluator(model: string | EvaluationModel) {
  return evaluator({
    name: CAPTURE_EVALUATOR_NAME,
    model,
    questions: captureQuestions,
  })
}

/**
 * Read capture's answer from an evaluator's output. Fails, naming
 * `captureQuestions`, when the block did not answer capture's question with
 * one of its two options: an evaluator built on other questions cannot gate
 * capture.
 */
export function readCaptureChoice(output: unknown): CaptureChoice {
  const answer = (output as { answers?: Record<string, unknown> } | null | undefined)?.answers?.capture as
    | { type?: unknown; choice?: unknown }
    | undefined
  if (answer?.type === 'choice' && (answer.choice === 'remember' || answer.choice === 'skip')) {
    return answer.choice
  }
  throw new Error(
    'memory capture: the evaluator did not answer the "capture" question with "remember" or "skip". ' +
      'Build the evaluator with captureQuestions (or captureEvaluator(model)).',
  )
}
