import { generator, type GeneratorConfig } from '@flow-state-dev/core'
import { z, type ZodTypeAny } from 'zod'

export type SalienceDimensions = Record<string, string>

const DEFAULT_DIMENSIONS = {
  goalRelevance: 'How relevant is this to the current active goal',
  recency: 'How recently was this information introduced',
  novelty: 'How new or unexpected is this relative to baseline',
  emotionalWeight: 'How emotionally significant is this information'
} as const satisfies SalienceDimensions

const scoreSchema = z.number().min(0).max(1)

// Per-dimension score as an array-of-pairs rather than `z.record(...)`. The
// dimension set is configurable (open-keyed), and an open-keyed map serializes
// to `additionalProperties: true`, which OpenAI strict structured-output mode
// rejects. See BP-016.
const dimensionScoreSchema = z.object({
  dimension: z.string(),
  score: scoreSchema
})

const salienceItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional()
})

const salienceInputSchema = z.object({
  items: z.array(z.union([z.string(), salienceItemSchema])).min(1),
  activeGoal: z.string().optional(),
  activeTask: z.string().optional(),
  baseline: z.string().optional()
})

const salienceOutputSchema = z.object({
  scores: z.array(dimensionScoreSchema),
  composite: scoreSchema,
  ranking: z.array(z.string()),
  itemScores: z.array(
    z.object({
      itemId: z.string(),
      scores: z.array(dimensionScoreSchema),
      composite: scoreSchema,
      reasoning: z.string().nullable()
    })
  )
})

export interface ScoreSalienceConfig<TOutputSchema extends ZodTypeAny = typeof salienceOutputSchema> {
  name: string
  dimensions?: SalienceDimensions
  weights?: Record<string, number>
  model?: GeneratorConfig['model']
  outputSchema?: TOutputSchema
}

function normalizeItems(input: z.infer<typeof salienceInputSchema>) {
  return input.items.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `item-${index + 1}`, content: item }
    }

    return item
  })
}

function formatWeights(dimensions: SalienceDimensions, weights: Record<string, number>) {
  return Object.keys(dimensions)
    .map((dimension) => `${dimension}: ${weights[dimension] ?? 0}`)
    .join('\n')
}

/**
 * Factory that returns a generator block for task-aware salience scoring.
 */
export function scoreSalience<TOutputSchema extends ZodTypeAny = typeof salienceOutputSchema>(
  config: ScoreSalienceConfig<TOutputSchema>
) {
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS
  const dimensionEntries = Object.entries(dimensions)

  if (dimensionEntries.length === 0) {
    throw new Error('scoreSalience requires at least one dimension')
  }

  const weights = config.weights ?? {}

  return generator({
    name: config.name,
    model: config.model ?? 'gpt-5-mini',
    inputSchema: salienceInputSchema,
    outputSchema: config.outputSchema ?? salienceOutputSchema,
    itemVisibility: { client: false, history: false },
    prompt: [
      'You are a salience scoring assistant for cognitive attention management.',
      'Score each item along all dimensions on a 0-1 scale, then compute composite salience.',
      'Dimensions:',
      ...dimensionEntries.map(([key, description]) => `- ${key}: ${description}`),
      'Weighting (use these weights for composite scoring):',
      formatWeights(dimensions, weights),
      'Return schema-conformant output with:',
      '- scores: aggregate per-dimension scores across considered items',
      '- composite: aggregate weighted salience score',
      '- itemScores: per-item scores/composite',
      '- ranking: ordered item IDs from highest to lowest salience'
    ].join('\n'),
    user: (input: z.infer<typeof salienceInputSchema>) => {
      const items = normalizeItems(input)
      return JSON.stringify(
        {
          activeGoal: input.activeGoal,
          activeTask: input.activeTask,
          baseline: input.baseline,
          items
        },
        null,
        2
      )
    }
  })
}

export {
  DEFAULT_DIMENSIONS as scoreSalienceDefaultDimensions,
  salienceInputSchema as scoreSalienceInputSchema,
  salienceOutputSchema as scoreSalienceOutputSchema
}
