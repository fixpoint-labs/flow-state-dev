/**
 * What consolidation and prune return when model output can and cannot be
 * recovered. A scripted text model drives the real repair pipeline;
 * `mockGenerator` skips it.
 */
import { describe, expect, it } from 'vitest'
import { testBlock } from '@flow-state-dev/testing'
import { handler, sequencer } from '@flow-state-dev/core'
import type { GeneratorModel } from '@flow-state-dev/core/types'
import { z } from 'zod'
import { consolidationGenerate, pruneGenerate } from '../src/memory-system-blocks.js'

/**
 * A model resolver whose every model (including core's coercion-repair model)
 * answers with `text`. Counts calls so a test can see the coercion pass ran.
 */
function textModel(text: string) {
  const calls: string[] = []
  const resolver = Object.assign(
    (modelId: string): GeneratorModel => ({
      modelId,
      async generate() {
        calls.push(modelId)
        return { text }
      },
    }) as GeneratorModel,
    { resolveId: (modelId: string) => modelId },
  )
  return { resolver, calls }
}

const semanticConfig = {
  model: 'gpt-5-mini',
  semantic: { scope: 'user' as const, consolidation: { episodicThreshold: 5, onEviction: true, minInterval: 10 } },
} as any

const pruneInput = { triggered: true, facts: [] }
const consolidateInput = { triggered: true, episodes: [], existingFacts: [] }

describe('prune output repair', () => {
  it('fails, rather than returning an empty prune, when the output is unparseable', async () => {
    const { resolver, calls } = textModel('Sorry, I could not review these facts right now.')
    const result = await testBlock(pruneGenerate(semanticConfig), { input: pruneInput, modelResolver: resolver as any })

    expect(result.output).not.toEqual({ removals: [], merges: [] })
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toMatch(/output validation failed/)
    // Deterministic repair gave up and the coercion pass was tried before failing.
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('fails when the output parses but carries none of the envelope keys', async () => {
    const { resolver } = textModel('{"status": "unable to comply"}')
    const result = await testBlock(pruneGenerate(semanticConfig), { input: pruneInput, modelResolver: resolver as any })

    expect(result.error?.message).toMatch(/output validation failed/)
  })

  it('returns an empty prune when the model genuinely proposes nothing', async () => {
    const { resolver } = textModel('{"removals": [], "merges": []}')
    const result = await testBlock(pruneGenerate(semanticConfig), { input: pruneInput, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual({ removals: [], merges: [] })
  })

  it('patches a partial envelope that carries one of the keys', async () => {
    const { resolver } = textModel('{"removals": [{"factId": "f1", "reason": "stale"}]}')
    const result = await testBlock(pruneGenerate(semanticConfig), { input: pruneInput, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual({ removals: [{ factId: 'f1', reason: 'stale' }], merges: [] })
  })
})

describe('consolidation output repair', () => {
  const fact = {
    subject: 'user',
    content: 'Works as a nurse',
    confidence: 0.9,
    category: 'profession',
    sourceEpisodeIds: ['e1'],
    action: 'new',
    targetFactId: '',
  }

  it('fails, rather than returning no facts, when the output is unparseable', async () => {
    const { resolver } = textModel('I reviewed the episodes and here is my summary: the user is busy.')
    const result = await testBlock(consolidationGenerate(semanticConfig), { input: consolidateInput, modelResolver: resolver as any })

    expect(result.output).not.toEqual({ facts: [] })
    expect(result.error?.message).toMatch(/output validation failed/)
  })

  it('wraps a bare array of facts into the envelope', async () => {
    const { resolver } = textModel(JSON.stringify([fact]))
    const result = await testBlock(consolidationGenerate(semanticConfig), { input: consolidateInput, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual({ facts: [fact] })
  })

  it('keeps the complete facts from output truncated mid-array', async () => {
    const complete = JSON.stringify({ facts: [fact] })
    const truncated = `${complete.slice(0, -2)}, {"subject": "user", "content": "Lives in`
    const { resolver } = textModel(truncated)
    const result = await testBlock(consolidationGenerate(semanticConfig), { input: consolidateInput, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual({ facts: [fact] })
  })

  it('returns no facts when the model genuinely found none', async () => {
    const { resolver } = textModel('```json\n{"facts": []}\n```')
    const result = await testBlock(consolidationGenerate(semanticConfig), { input: consolidateInput, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual({ facts: [] })
  })
})

describe('a failed recovery in the background', () => {
  const unparseable = 'Sorry, I could not review these facts right now.'
  const reply = handler({ name: 'reply', inputSchema: z.any(), execute: () => pruneInput })

  it('does not fail the turn it runs beside', async () => {
    const { resolver } = textModel(unparseable)
    const turn = sequencer({ name: 'turn', inputSchema: z.any() })
      .step(reply)
      .sideChain(pruneGenerate(semanticConfig))
    const result = await testBlock(turn, { input: {}, modelResolver: resolver as any })

    expect(result.error).toBeNull()
    expect(result.output).toEqual(pruneInput)
  })

  it('reaches a caller that waits on the side chain', async () => {
    const { resolver } = textModel(unparseable)
    const turn = sequencer({ name: 'turn', inputSchema: z.any() })
      .step(reply)
      .sideChain(pruneGenerate(semanticConfig))
      .waitForSideChain({ failOnError: true })
    const result = await testBlock(turn, { input: {}, modelResolver: resolver as any })

    expect(result.error?.message).toMatch(/output validation failed/)
  })
})
