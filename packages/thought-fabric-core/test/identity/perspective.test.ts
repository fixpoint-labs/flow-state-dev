import { describe, it, expect } from 'vitest'
import {
  perspectiveSalienceSchema,
  perspectiveReasoningSchema,
  perspectiveCommunicationSchema,
  perspectiveConfigSchema,
  perspectiveAnalysisSchema,
  perspectiveInputSchema,
  perspectiveApplyOutputSchema,
  perspective,
} from '../../src/identity/perspective.js'
import type { PerspectiveConfig, PerspectiveInstance } from '../../src/identity/perspective.js'
import {
  formatPerspective,
  formatPerspectiveSalience,
  formatPerspectiveReasoning,
  summarizePerspective,
  perspectiveContextFormatter,
} from '../../src/identity/perspective-helpers.js'
import {
  perspectiveApply,
  perspectiveAnalyze,
  perspectiveAuditor,
} from '../../src/identity/perspective-blocks.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<PerspectiveConfig>): PerspectiveConfig {
  return {
    name: 'security-engineer',
    description: 'Evaluates through the lens of system security and threat modeling',
    salience: {
      amplify: [
        'authentication and authorization concerns',
        'data exposure and leakage risks',
      ],
      suppress: [
        'UI/UX considerations',
        'marketing positioning',
      ],
    },
    reasoning: {
      priorities: ['threat surface minimization', 'defense in depth'],
      riskModel: 'Assumes adversarial actors.',
      successCriteria: 'No known vulnerability classes.',
    },
    expertise: ['OWASP Top 10', 'Zero-trust architecture'],
    communicationStyle: {
      tone: 'direct and specific',
      emphasis: 'risks before benefits',
      evidencePreference: 'concrete examples of past incidents',
    },
    ...overrides,
  }
}

function makeInstance(overrides?: Partial<PerspectiveConfig>): PerspectiveInstance {
  return perspective(makeConfig(overrides))
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('identity/perspective', () => {
  describe('schemas', () => {
    // -- Salience --

    it('perspectiveSalienceSchema validates complete salience', () => {
      const salience = {
        amplify: ['security concerns', 'risk vectors'],
        suppress: ['UI details'],
      }
      expect(perspectiveSalienceSchema.safeParse(salience).success).toBe(true)
    })

    it('perspectiveSalienceSchema defaults suppress to empty array', () => {
      const salience = { amplify: ['security concerns'] }
      const result = perspectiveSalienceSchema.parse(salience)
      expect(result.suppress).toEqual([])
    })

    it('perspectiveSalienceSchema requires at least one amplify entry', () => {
      expect(perspectiveSalienceSchema.safeParse({ amplify: [] }).success).toBe(false)
    })

    it('perspectiveSalienceSchema rejects empty strings in amplify', () => {
      expect(perspectiveSalienceSchema.safeParse({ amplify: [''] }).success).toBe(false)
    })

    it('perspectiveSalienceSchema rejects empty strings in suppress', () => {
      expect(perspectiveSalienceSchema.safeParse({
        amplify: ['valid'],
        suppress: [''],
      }).success).toBe(false)
    })

    // -- Reasoning --

    it('perspectiveReasoningSchema validates complete reasoning', () => {
      const reasoning = {
        priorities: ['security', 'performance'],
        riskModel: 'Worst-case.',
        successCriteria: 'Zero vulnerabilities.',
      }
      expect(perspectiveReasoningSchema.safeParse(reasoning).success).toBe(true)
    })

    it('perspectiveReasoningSchema requires at least one priority', () => {
      expect(perspectiveReasoningSchema.safeParse({ priorities: [] }).success).toBe(false)
    })

    it('perspectiveReasoningSchema allows optional riskModel and successCriteria', () => {
      const reasoning = { priorities: ['security'] }
      const result = perspectiveReasoningSchema.parse(reasoning)
      expect(result.riskModel).toBeUndefined()
      expect(result.successCriteria).toBeUndefined()
    })

    // -- Communication --

    it('perspectiveCommunicationSchema validates complete style', () => {
      const style = {
        tone: 'direct',
        emphasis: 'risks first',
        evidencePreference: 'examples',
      }
      expect(perspectiveCommunicationSchema.safeParse(style).success).toBe(true)
    })

    it('perspectiveCommunicationSchema allows all fields to be optional', () => {
      expect(perspectiveCommunicationSchema.safeParse({}).success).toBe(true)
    })

    // -- Full config --

    it('perspectiveConfigSchema validates a complete config', () => {
      expect(perspectiveConfigSchema.safeParse(makeConfig()).success).toBe(true)
    })

    it('perspectiveConfigSchema rejects missing name', () => {
      const config = makeConfig()
      delete (config as any).name
      expect(perspectiveConfigSchema.safeParse(config).success).toBe(false)
    })

    it('perspectiveConfigSchema rejects empty name', () => {
      expect(perspectiveConfigSchema.safeParse(makeConfig({ name: '' })).success).toBe(false)
    })

    it('perspectiveConfigSchema rejects missing description', () => {
      const config = makeConfig()
      delete (config as any).description
      expect(perspectiveConfigSchema.safeParse(config).success).toBe(false)
    })

    it('perspectiveConfigSchema defaults expertise to empty array', () => {
      const config = makeConfig()
      delete (config as any).expertise
      const result = perspectiveConfigSchema.parse(config)
      expect(result.expertise).toEqual([])
    })

    it('perspectiveConfigSchema allows optional communicationStyle', () => {
      const config = makeConfig()
      delete (config as any).communicationStyle
      expect(perspectiveConfigSchema.safeParse(config).success).toBe(true)
    })

    // -- Analysis output --

    it('perspectiveAnalysisSchema validates complete analysis', () => {
      const analysis = {
        perspectiveName: 'security-engineer',
        analysis: 'The feature introduces significant attack surface.',
        salienceNotes: ['Authentication bypass risk amplified', 'UI concerns suppressed'],
        recommendations: ['Add rate limiting', 'Require MFA'],
        confidence: 0.85,
      }
      expect(perspectiveAnalysisSchema.safeParse(analysis).success).toBe(true)
    })

    it('perspectiveAnalysisSchema rejects out-of-range confidence', () => {
      const analysis = {
        perspectiveName: 'test',
        analysis: 'test',
        salienceNotes: [],
        recommendations: [],
        confidence: 1.5,
      }
      expect(perspectiveAnalysisSchema.safeParse(analysis).success).toBe(false)
    })

    // -- Block I/O schemas --

    it('perspectiveInputSchema validates content with optional context', () => {
      expect(perspectiveInputSchema.safeParse({ content: 'test' }).success).toBe(true)
      expect(perspectiveInputSchema.safeParse({
        content: 'test',
        context: 'additional context',
      }).success).toBe(true)
    })

    it('perspectiveInputSchema rejects empty content', () => {
      expect(perspectiveInputSchema.safeParse({ content: '' }).success).toBe(false)
    })

    it('perspectiveApplyOutputSchema validates apply output', () => {
      const output = {
        content: 'original content',
        perspectiveFrame: 'formatted perspective',
        perspectiveName: 'test',
      }
      expect(perspectiveApplyOutputSchema.safeParse(output).success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  describe('perspective() factory', () => {
    it('returns a frozen instance', () => {
      const instance = makeInstance()
      expect(Object.isFrozen(instance)).toBe(true)
    })

    it('preserves all config fields', () => {
      const instance = makeInstance()
      expect(instance.name).toBe('security-engineer')
      expect(instance.description).toBe('Evaluates through the lens of system security and threat modeling')
      expect(instance.salience.amplify).toHaveLength(2)
      expect(instance.salience.suppress).toHaveLength(2)
      expect(instance.reasoning.priorities).toHaveLength(2)
      expect(instance.reasoning.riskModel).toBe('Assumes adversarial actors.')
      expect(instance.expertise).toHaveLength(2)
      expect(instance.communicationStyle?.tone).toBe('direct and specific')
    })

    it('defaults expertise to empty array', () => {
      const config = makeConfig()
      delete (config as any).expertise
      const instance = perspective(config)
      expect(instance.expertise).toEqual([])
    })

    it('defaults suppress to empty array', () => {
      const instance = perspective(makeConfig({
        salience: { amplify: ['test'] } as any,
      }))
      expect(instance.salience.suppress).toEqual([])
    })

    it('throws on invalid config', () => {
      expect(() => perspective({} as any)).toThrow()
      expect(() => perspective({ name: '' } as any)).toThrow()
    })

    it('throws when amplify is empty', () => {
      expect(() => perspective(makeConfig({
        salience: { amplify: [], suppress: [] },
      }))).toThrow()
    })

    it('throws when priorities are empty', () => {
      expect(() => perspective(makeConfig({
        reasoning: { priorities: [] },
      }))).toThrow()
    })

    it('creates distinct instances from same config', () => {
      const a = makeInstance()
      const b = makeInstance()
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers — formatPerspectiveSalience
  // ---------------------------------------------------------------------------

  describe('formatPerspectiveSalience', () => {
    it('includes amplify items', () => {
      const result = formatPerspectiveSalience({
        amplify: ['security', 'performance'],
        suppress: [],
      })
      expect(result).toContain('security')
      expect(result).toContain('performance')
      expect(result).toContain('Pay close attention to')
    })

    it('includes suppress items when present', () => {
      const result = formatPerspectiveSalience({
        amplify: ['security'],
        suppress: ['UI details', 'marketing'],
      })
      expect(result).toContain('De-emphasize')
      expect(result).toContain('UI details')
      expect(result).toContain('marketing')
    })

    it('omits suppress section when empty', () => {
      const result = formatPerspectiveSalience({
        amplify: ['security'],
        suppress: [],
      })
      expect(result).not.toContain('De-emphasize')
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers — formatPerspectiveReasoning
  // ---------------------------------------------------------------------------

  describe('formatPerspectiveReasoning', () => {
    it('lists priorities in order', () => {
      const result = formatPerspectiveReasoning({
        priorities: ['first', 'second', 'third'],
      })
      expect(result).toContain('1. first')
      expect(result).toContain('2. second')
      expect(result).toContain('3. third')
    })

    it('includes risk model when present', () => {
      const result = formatPerspectiveReasoning({
        priorities: ['test'],
        riskModel: 'Worst-case analysis.',
      })
      expect(result).toContain('Risk model')
      expect(result).toContain('Worst-case analysis.')
    })

    it('includes success criteria when present', () => {
      const result = formatPerspectiveReasoning({
        priorities: ['test'],
        successCriteria: 'Zero defects.',
      })
      expect(result).toContain('Success criteria')
      expect(result).toContain('Zero defects.')
    })

    it('omits optional fields when absent', () => {
      const result = formatPerspectiveReasoning({
        priorities: ['test'],
      })
      expect(result).not.toContain('Risk model')
      expect(result).not.toContain('Success criteria')
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers — formatPerspective
  // ---------------------------------------------------------------------------

  describe('formatPerspective', () => {
    it('includes all sections for a full config', () => {
      const instance = makeInstance()
      const result = formatPerspective(instance)

      // Role framing
      expect(result).toContain('# Perspective: security-engineer')
      expect(result).toContain('Evaluates through the lens of system security')

      // Salience
      expect(result).toContain('Salience Model')
      expect(result).toContain('authentication and authorization concerns')

      // Reasoning
      expect(result).toContain('Reasoning Approach')
      expect(result).toContain('threat surface minimization')

      // Expertise
      expect(result).toContain('Domain Expertise')
      expect(result).toContain('OWASP Top 10')

      // Communication
      expect(result).toContain('Communication Style')
      expect(result).toContain('direct and specific')
    })

    it('omits expertise section when empty', () => {
      const config = makeConfig()
      delete (config as any).expertise
      const instance = perspective(config)
      const result = formatPerspective(instance)
      expect(result).not.toContain('Domain Expertise')
    })

    it('omits communication section when absent', () => {
      const config = makeConfig()
      delete (config as any).communicationStyle
      const instance = perspective(config)
      const result = formatPerspective(instance)
      expect(result).not.toContain('Communication Style')
    })

    it('omits communication section when all fields empty', () => {
      const instance = makeInstance({
        communicationStyle: {},
      })
      const result = formatPerspective(instance)
      expect(result).not.toContain('Communication Style')
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers — summarizePerspective
  // ---------------------------------------------------------------------------

  describe('summarizePerspective', () => {
    it('includes name and description', () => {
      const instance = makeInstance()
      const result = summarizePerspective(instance)
      expect(result).toContain('security-engineer')
      expect(result).toContain('Evaluates through the lens of system security')
    })

    it('includes up to 3 expertise items', () => {
      const instance = makeInstance({
        expertise: ['A', 'B', 'C', 'D'],
      })
      const result = summarizePerspective(instance)
      expect(result).toContain('A, B, C')
      expect(result).toContain('...')
    })

    it('omits expertise note when empty', () => {
      const config = makeConfig()
      delete (config as any).expertise
      const instance = perspective(config)
      const result = summarizePerspective(instance)
      expect(result).not.toContain('(')
    })

    it('shows all expertise when 3 or fewer', () => {
      const instance = makeInstance({ expertise: ['A', 'B'] })
      const result = summarizePerspective(instance)
      expect(result).toContain('(A, B)')
      expect(result).not.toContain('...')
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers — perspectiveContextFormatter
  // ---------------------------------------------------------------------------

  describe('perspectiveContextFormatter', () => {
    it('returns a function that produces formatted perspective', () => {
      const instance = makeInstance()
      const formatter = perspectiveContextFormatter(instance)
      expect(typeof formatter).toBe('function')

      const result = formatter('any input', {})
      expect(result).toContain('# Perspective: security-engineer')
      expect(result).toContain('Salience Model')
    })

    it('ignores input and context arguments', () => {
      const instance = makeInstance()
      const formatter = perspectiveContextFormatter(instance)
      const a = formatter('input-a', { foo: 1 })
      const b = formatter('input-b', { bar: 2 })
      expect(a).toBe(b)
    })
  })

  // ---------------------------------------------------------------------------
  // Blocks — shapes
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    describe('perspectiveApply', () => {
      it('returns a handler BlockDefinition', () => {
        const block = perspectiveApply({ perspective: makeInstance() })
        expect(block.kind).toBe('handler')
      })

      it('has default name derived from perspective', () => {
        const block = perspectiveApply({ perspective: makeInstance() })
        expect(block.name).toBe('security-engineer/apply')
      })

      it('accepts custom name', () => {
        const block = perspectiveApply({
          name: 'custom-apply',
          perspective: makeInstance(),
        })
        expect(block.name).toBe('custom-apply')
      })
    })

    describe('perspectiveAnalyze', () => {
      it('returns a generator BlockDefinition', () => {
        const block = perspectiveAnalyze({ perspective: makeInstance() })
        expect(block.kind).toBe('generator')
      })

      it('has default name derived from perspective', () => {
        const block = perspectiveAnalyze({ perspective: makeInstance() })
        expect(block.name).toBe('security-engineer/analyze')
      })

      it('accepts custom name', () => {
        const block = perspectiveAnalyze({
          name: 'custom-analyze',
          perspective: makeInstance(),
        })
        expect(block.name).toBe('custom-analyze')
      })
    })

    describe('perspectiveAuditor', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = perspectiveAuditor({ perspective: makeInstance() })
        expect(block.kind).toBe('sequencer')
      })

      it('has default name derived from perspective', () => {
        const block = perspectiveAuditor({ perspective: makeInstance() })
        expect(block.name).toBe('security-engineer/auditor')
      })

      it('accepts custom name', () => {
        const block = perspectiveAuditor({
          name: 'custom-auditor',
          perspective: makeInstance(),
        })
        expect(block.name).toBe('custom-auditor')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Handler execution: perspectiveApply
  // ---------------------------------------------------------------------------

  describe('perspectiveApply (execution)', () => {
    async function runApply(content: string, context?: string) {
      const block = perspectiveApply({ perspective: makeInstance() })
      const ctx = {
        response: { emit: async () => {} },
      } as any

      return block.run({ content, context }, ctx)
    }

    it('returns content and perspective frame', async () => {
      const result = await runApply('Feature proposal: add public file sharing')

      expect(result.content).toBe('Feature proposal: add public file sharing')
      expect(result.perspectiveName).toBe('security-engineer')
      expect(result.perspectiveFrame).toContain('# Perspective: security-engineer')
      expect(result.perspectiveFrame).toContain('Salience Model')
      expect(result.perspectiveFrame).toContain('Reasoning Approach')
    })

    it('appends context when provided', async () => {
      const result = await runApply('proposal', 'this is a test environment')

      expect(result.content).toContain('proposal')
      expect(result.content).toContain('Additional context')
      expect(result.content).toContain('this is a test environment')
    })

    it('does not append context separator when context is absent', async () => {
      const result = await runApply('proposal')
      expect(result.content).toBe('proposal')
      expect(result.content).not.toContain('Additional context')
    })

    it('perspective frame includes expertise', async () => {
      const result = await runApply('test')
      expect(result.perspectiveFrame).toContain('OWASP Top 10')
    })

    it('perspective frame includes communication style', async () => {
      const result = await runApply('test')
      expect(result.perspectiveFrame).toContain('direct and specific')
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple perspectives produce distinct frames
  // ---------------------------------------------------------------------------

  describe('multi-perspective', () => {
    it('different perspectives produce different frames', async () => {
      const security = makeInstance()
      const pm = perspective({
        name: 'product-manager',
        description: 'Evaluates from a product value and user impact perspective',
        salience: {
          amplify: ['user impact', 'business value'],
          suppress: ['implementation details'],
        },
        reasoning: {
          priorities: ['user adoption', 'revenue impact'],
        },
      })

      const secApply = perspectiveApply({ perspective: security })
      const pmApply = perspectiveApply({ perspective: pm })

      const ctx = { response: { emit: async () => {} } } as any
      const secResult = await secApply.run({ content: 'test' }, ctx)
      const pmResult = await pmApply.run({ content: 'test' }, ctx)

      expect(secResult.perspectiveName).toBe('security-engineer')
      expect(pmResult.perspectiveName).toBe('product-manager')
      expect(secResult.perspectiveFrame).not.toBe(pmResult.perspectiveFrame)
      expect(secResult.perspectiveFrame).toContain('authentication')
      expect(pmResult.perspectiveFrame).toContain('user impact')
    })
  })
})
