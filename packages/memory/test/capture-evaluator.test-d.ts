/**
 * Compile-time half of the capture evaluator slot: what `system({ evaluator })`
 * and `captureEvaluator(model)` accept.
 *
 * Vitest strips types rather than checking them, and this package's `src`
 * typecheck does not include `test/`. So `tsconfig.test-d.json` compiles every
 * `.test-d.ts` file here, and the `typecheck` script runs it after the `src`
 * pass. Each `@ts-expect-error` below is its own negative control: widen the
 * type it guards and the suppression has nothing to suppress, which is itself
 * an error (TS2578), so `pnpm typecheck` goes red either way.
 */
import { boolean, choice, evaluator } from '@flow-state-dev/core'
import type { EvaluationModel } from '@flow-state-dev/core'
import { captureEvaluator, captureQuestions, system } from '../src'

declare const evaluationModel: EvaluationModel
/** A model that can generate but not evaluate: an AI SDK language model's shape. */
declare const languageModel: {
  specificationVersion: 'v2'
  provider: string
  modelId: string
  doGenerate: (options: unknown) => Promise<unknown>
  doStream: (options: unknown) => Promise<unknown>
}

const base = { model: 'openai/gpt-5.4-mini', working: true } as const

// The helper, on a model string and on an evaluation model instance.
system({ ...base, evaluator: captureEvaluator('typesafe-ai/jev') })
system({ ...base, evaluator: captureEvaluator(evaluationModel) })

// A hand-built block on memory's question.
system({
  ...base,
  evaluator: evaluator({ name: 'memory-gate', model: 'typesafe-ai/jev', questions: captureQuestions }),
})

// Extra questions beside memory's are allowed; memory reads only its own.
system({
  ...base,
  evaluator: evaluator({
    name: 'memory-gate',
    model: evaluationModel,
    questions: { ...captureQuestions, urgent: boolean('Does this need someone now?') },
  }),
})

// An evaluator that lacks memory's question cannot gate capture.
system({
  ...base,
  // @ts-expect-error — no `capture` question
  evaluator: evaluator({
    name: 'triage',
    model: evaluationModel,
    questions: { team: choice('Which team?', { billing: null, technical: null }) },
  }),
})

// A `capture` question with other options cannot gate capture either.
system({
  ...base,
  // @ts-expect-error — `capture` must answer remember | skip
  evaluator: evaluator({
    name: 'wrong-options',
    model: evaluationModel,
    questions: { capture: choice('Keep it?', { yes: null, no: null }) },
  }),
})

// A model that can only generate is refused where core's evaluator refuses it.
// @ts-expect-error — not an evaluation model
captureEvaluator(languageModel)
// @ts-expect-error — core's evaluator refuses it the same way
evaluator({ name: 'x', model: languageModel, questions: captureQuestions })
