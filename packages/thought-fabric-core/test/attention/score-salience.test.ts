import { describe, expect, it } from 'vitest'
import { scoreSalience } from '../../src/attention/score-salience.js'

describe('attention/scoreSalience', () => {
  it('returns a generator BlockDefinition', () => {
    const block = scoreSalience({
      name: 'task-salience'
    })

    expect(block.kind).toBe('generator')
    expect(block.name).toBe('task-salience')
  })

  it('includes configured dimensions and weights in the prompt', () => {
    const block = scoreSalience({
      name: 'custom-salience',
      dimensions: {
        urgency: 'How urgent this is right now',
        strategicImpact: 'How much this affects long-term outcomes'
      },
      weights: {
        urgency: 0.7,
        strategicImpact: 0.3
      }
    })

    const prompt = (block as any).config.prompt as string
    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('urgency')
    expect(prompt).toContain('strategicImpact')
    expect(prompt).toContain('urgency: 0.7')
    expect(prompt).toContain('strategicImpact: 0.3')
  })

  it('normalizes string items into ids in user payload', async () => {
    const block = scoreSalience({ name: 'normalize-items' })
    const userSlot = (block as any).config.user as (input: { items: string[] }) => Promise<string> | string

    const payload = await userSlot({
      items: ['first', 'second']
    })

    expect(String(payload)).toContain('"id": "item-1"')
    expect(String(payload)).toContain('"id": "item-2"')
  })
})
