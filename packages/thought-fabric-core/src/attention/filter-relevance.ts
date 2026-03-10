import { handler } from '@flow-state-dev/core'
import { z, type ZodTypeAny } from 'zod'

export type RelevanceCriteria = Record<string, string>

const DEFAULT_CRITERIA = {
  taskAlignment: 'Must be directly relevant to the current reasoning task',
  informationGain: 'Must add new information not already in working memory',
  actionability: 'Must be something that can inform a decision or next step'
} as const satisfies RelevanceCriteria

const scoredItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  scores: z.record(z.number().min(0).max(1)).optional(),
  composite: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
})

const filterInputSchema = z.object({
  task: z.string(),
  items: z.array(z.union([z.string(), scoredItemSchema]))
})

const hardOutputSchema = z.object({
  mode: z.literal('hard'),
  threshold: z.number().min(0).max(1),
  items: z.array(scoredItemSchema),
  excluded: z.array(z.string())
})

const softOutputSchema = z.object({
  mode: z.literal('soft'),
  threshold: z.number().min(0).max(1),
  items: z.array(
    scoredItemSchema.extend({
      relevance: z.object({
        scores: z.record(z.number().min(0).max(1)),
        composite: z.number().min(0).max(1),
        passed: z.boolean()
      })
    })
  )
})

export interface FilterRelevanceConfig<TOutputSchema extends ZodTypeAny = ZodTypeAny> {
  name: string
  criteria?: RelevanceCriteria
  threshold?: number
  mode?: 'hard' | 'soft'
  outputSchema?: TOutputSchema
}

function toNormalizedItem(item: z.infer<typeof scoredItemSchema> | string, index: number) {
  if (typeof item === 'string') {
    return { id: `item-${index + 1}`, content: item }
  }

  return item
}

function getKeywords(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2)
}

function keywordOverlap(task: string, content: string) {
  const taskKeywords = new Set(getKeywords(task))
  const contentKeywords = getKeywords(content)

  if (taskKeywords.size === 0 || contentKeywords.length === 0) {
    return 0
  }

  let matches = 0
  for (const token of contentKeywords) {
    if (taskKeywords.has(token)) {
      matches += 1
    }
  }

  return Math.min(1, matches / taskKeywords.size)
}

function computeRelevance(
  item: ReturnType<typeof toNormalizedItem>,
  task: string,
  criteria: RelevanceCriteria
) {
  const criterionNames = Object.keys(criteria)
  const heuristic = keywordOverlap(task, item.content)

  const scores: Record<string, number> = {}
  for (const criterion of criterionNames) {
    scores[criterion] = item.scores?.[criterion] ?? heuristic
  }

  const criterionComposite =
    criterionNames.reduce((total, criterion) => total + scores[criterion], 0) /
    Math.max(criterionNames.length, 1)

  const composite = item.composite === undefined ? criterionComposite : (criterionComposite + item.composite) / 2

  return {
    scores,
    composite: Math.max(0, Math.min(1, composite))
  }
}

/**
 * Factory that returns a handler block for deterministic relevance filtering.
 */
export function filterRelevance<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: FilterRelevanceConfig<TOutputSchema>
) {
  const criteria = config.criteria ?? DEFAULT_CRITERIA
  const threshold = config.threshold ?? 0.6
  const mode = config.mode ?? 'hard'

  const outputSchema =
    config.outputSchema ?? (mode === 'hard' ? hardOutputSchema : softOutputSchema)

  return handler({
    name: config.name,
    inputSchema: filterInputSchema,
    outputSchema,
    execute: (input: z.infer<typeof filterInputSchema>) => {
      const scored = input.items.map((item: z.infer<typeof scoredItemSchema> | string, index: number) => {
        const normalized = toNormalizedItem(item, index)
        const relevance = computeRelevance(normalized, input.task, criteria)

        return {
          ...normalized,
          relevance,
          passed: relevance.composite >= threshold
        }
      })

      if (mode === 'hard') {
        return {
          mode,
          threshold,
          items: scored.filter((entry) => entry.passed).map(({ relevance: _relevance, passed: _passed, ...item }: { relevance: { scores: Record<string, number>; composite: number }; passed: boolean; id: string; content: string; scores?: Record<string, number>; composite?: number; metadata?: Record<string, unknown> }) => item),
          excluded: scored.filter((entry) => !entry.passed).map((entry) => entry.id)
        }
      }

      return {
        mode,
        threshold,
        items: scored.map(({ passed, relevance, ...item }: { passed: boolean; relevance: { scores: Record<string, number>; composite: number }; id: string; content: string; scores?: Record<string, number>; composite?: number; metadata?: Record<string, unknown> }) => ({
          ...item,
          relevance: {
            ...relevance,
            passed
          }
        }))
      }
    }
  })
}

export {
  DEFAULT_CRITERIA as filterRelevanceDefaultCriteria,
  filterInputSchema as filterRelevanceInputSchema,
  hardOutputSchema as filterRelevanceHardOutputSchema,
  softOutputSchema as filterRelevanceSoftOutputSchema
}
