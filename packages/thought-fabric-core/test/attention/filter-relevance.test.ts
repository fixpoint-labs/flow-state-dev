import { describe, expect, it } from 'vitest'
import { filterRelevance } from '../../src/attention/filter-relevance.js'
import { createMockContext } from '../helpers.js'

describe('attention/filterRelevance', () => {
  it('returns a handler BlockDefinition', () => {
    const block = filterRelevance({
      name: 'reasoning-filter'
    })

    expect(block.kind).toBe('handler')
    expect(block.name).toBe('reasoning-filter')
  })

  it('hard mode filters out items below threshold', async () => {
    const block = filterRelevance({
      name: 'hard-filter',
      threshold: 0.6,
      mode: 'hard'
    })

    const output = await block.run(
      {
        task: 'plan next engineering steps',
        items: [
          { id: 'a', content: 'Engineering plan draft', composite: 0.9 },
          { id: 'b', content: 'Vacation memories', composite: 0.1 }
        ]
      },
      createMockContext()
    )

    expect(output.mode).toBe('hard')
    expect(output.items.map((item: { id: string }) => item.id)).toEqual(['a'])
    expect(output.excluded).toEqual(['b'])
  })

  it('soft mode annotates items with relevance scores', async () => {
    const block = filterRelevance({
      name: 'soft-filter',
      mode: 'soft',
      criteria: {
        taskAlignment: 'Relevant to active task'
      }
    })

    const output = await block.run(
      {
        task: 'pricing strategy memo',
        items: ['pricing strategy summary']
      },
      createMockContext()
    )

    expect(output.mode).toBe('soft')
    expect(output.items).toHaveLength(1)
    const annotatedItem = output.items[0] as (typeof output.items)[number] & { relevance: { scores: Record<string, number>; passed: boolean } }
    expect(annotatedItem.relevance.scores.taskAlignment).toBeGreaterThan(0)
    expect(typeof annotatedItem.relevance.passed).toBe('boolean')
  })
})
