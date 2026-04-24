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
  perspectiveObservationSchema,
  perspectiveObservationsStateSchema,
  perspectivePositionSchema,
  perspectivePositionsStateSchema,
  perspectiveObservationsResource,
  perspectivePositionsResource,
  createPerspectivePositionsResource,
} from '../../src/identity/perspective.js'
import type {
  PerspectiveConfig,
  PerspectiveInstance,
  PerspectiveObservationsState,
  PerspectivePositionsState,
} from '../../src/identity/perspective.js'
import {
  formatPerspective,
  formatPerspectiveSalience,
  formatPerspectiveReasoning,
  summarizePerspective,
  perspectiveContextFormatter,
  addPerspectiveObservation,
  removePerspectiveObservation,
  perspectiveObservations,
  advancePerspectiveObservations,
  formatPerspectiveObservations,
  addPerspectivePosition,
  challengePerspectivePosition,
  removePerspectivePosition,
  perspectivePositions,
  formatPerspectivePositions,
  formatPerspectiveAccumulated,
} from '../../src/identity/perspective-helpers.js'
import type {
  PerspectiveObservationsRef,
  PerspectivePositionsRef,
} from '../../src/identity/perspective-helpers.js'
import {
  perspectiveApply,
  perspectiveAnalyze,
  perspectiveAuditor,
  perspectiveObserve,
  perspectivePosition,
  perspectiveChallenge,
  perspectiveSnapshot,
  perspectiveAdvance,
} from '../../src/identity/perspective-blocks.js'
import { createPerspectiveCapability } from '../../src/identity/perspective-capability.js'
import { system } from '../../src/identity/perspective-system.js'

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

// ===========================================================================
// Phase B — Resource-backed state tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Mock refs
// ---------------------------------------------------------------------------

function createMockObservationsRef(
  initialState?: Partial<PerspectiveObservationsState>,
): PerspectiveObservationsRef {
  let state: PerspectiveObservationsState = {
    observations: [],
    turnCounter: 0,
    ...initialState,
  }
  return {
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as PerspectiveObservationsState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
  } as PerspectiveObservationsRef
}

function createMockPositionsRef(
  initialState?: Partial<PerspectivePositionsState>,
): PerspectivePositionsRef {
  let state: PerspectivePositionsState = {
    positions: [],
    ...initialState,
  }
  return {
    get state() { return state },
    patchState: async (updates) => { state = { ...state, ...updates } as PerspectivePositionsState },
    setState: async (next) => { state = next },
    updateState: async (fn) => { state = await fn(state) },
  } as PerspectivePositionsRef
}

// Build a mock ctx that supports both ctx.session.resources.get('key') (used
// by blocks) and ctx.session.resources.key (used by capability fns).
function makeCtx(opts: {
  observations?: PerspectiveObservationsRef
  positions?: PerspectivePositionsRef
  positionScope?: 'session' | 'user' | 'project'
}) {
  const scope = opts.positionScope ?? 'session'
  const sessionResources: Record<string, unknown> = {}
  if (opts.observations) sessionResources.perspectiveObservations = opts.observations
  if (scope === 'session' && opts.positions) sessionResources.perspectivePositions = opts.positions

  const userResources: Record<string, unknown> = scope === 'user' && opts.positions
    ? { perspectivePositions: opts.positions } : {}
  const projectResources: Record<string, unknown> = scope === 'project' && opts.positions
    ? { perspectivePositions: opts.positions } : {}

  const makeScope = (res: Record<string, unknown>) => ({
    ...res,
    resources: {
      ...res,
      get: (k: string) => res[k],
      list: () => Object.values(res),
    },
  })

  return {
    session: makeScope(sessionResources),
    user: makeScope(userResources),
    project: makeScope(projectResources),
    response: { emit: async () => {} },
  } as any
}

// ---------------------------------------------------------------------------
// Phase B — Schemas
// ---------------------------------------------------------------------------

describe('identity/perspective — Phase B schemas', () => {
  it('perspectiveObservationSchema validates a complete observation', () => {
    const obs = {
      id: 'o1',
      content: 'Auth endpoint lacks rate limiting',
      category: 'concern',
      confidence: 0.9,
      addedAt: 3,
    }
    expect(perspectiveObservationSchema.safeParse(obs).success).toBe(true)
  })

  it('perspectiveObservationSchema accepts optional source', () => {
    const obs = {
      id: 'o1',
      content: 'test',
      category: 'concern',
      confidence: 0.9,
      source: 'analysis',
      addedAt: 0,
    }
    expect(perspectiveObservationSchema.safeParse(obs).success).toBe(true)
  })

  it('perspectiveObservationSchema rejects out-of-range confidence', () => {
    const obs = {
      id: 'o1', content: 't', category: 'c', confidence: 1.5, addedAt: 0,
    }
    expect(perspectiveObservationSchema.safeParse(obs).success).toBe(false)
  })

  it('perspectiveObservationsStateSchema has empty defaults', () => {
    const parsed = perspectiveObservationsStateSchema.parse({
      observations: [],
      turnCounter: 0,
    })
    expect(parsed.observations).toEqual([])
    expect(parsed.turnCounter).toBe(0)
  })

  it('perspectivePositionSchema validates a complete position', () => {
    const pos = {
      id: 'p1',
      claim: 'Auth subsystem needs audit',
      reasoning: 'Multiple observations of auth gaps',
      confidence: 0.85,
      supportingObservations: ['o1', 'o2'],
      challenges: [],
      addedAt: 5,
    }
    expect(perspectivePositionSchema.safeParse(pos).success).toBe(true)
  })

  it('perspectivePositionSchema allows challenges array', () => {
    const pos = {
      id: 'p1',
      claim: 't',
      reasoning: 't',
      confidence: 0.5,
      supportingObservations: [],
      challenges: [{ evidence: 'counter', addedAt: 6 }],
      addedAt: 5,
    }
    expect(perspectivePositionSchema.safeParse(pos).success).toBe(true)
  })

  it('perspectivePositionsStateSchema has empty defaults', () => {
    const parsed = perspectivePositionsStateSchema.parse({ positions: [] })
    expect(parsed.positions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Phase B — Resources
// ---------------------------------------------------------------------------

describe('identity/perspective — Phase B resources', () => {
  it('perspectiveObservationsResource has correct default state', () => {
    expect(perspectiveObservationsResource.default).toEqual({
      observations: [],
      turnCounter: 0,
    })
    expect(perspectiveObservationsResource.writable).toBe(true)
  })

  it('perspectivePositionsResource has correct default state', () => {
    expect(perspectivePositionsResource.default).toEqual({ positions: [] })
    expect(perspectivePositionsResource.writable).toBe(true)
  })

  it('createPerspectivePositionsResource returns distinct refs per call', () => {
    const a = createPerspectivePositionsResource('user')
    const b = createPerspectivePositionsResource('user')
    expect(a).not.toBe(b)
    expect(a.default).toEqual(b.default)
  })

  it('createPerspectivePositionsResource handles all three scopes', () => {
    const session = createPerspectivePositionsResource('session')
    const user = createPerspectivePositionsResource('user')
    const project = createPerspectivePositionsResource('project')
    expect(session.writable).toBe(true)
    expect(user.writable).toBe(true)
    expect(project.writable).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase B — Observation helpers
// ---------------------------------------------------------------------------

describe('identity/perspective — observation helpers', () => {
  describe('addPerspectiveObservation', () => {
    it('adds an observation with generated ID and turn stamp', async () => {
      const ref = createMockObservationsRef({ turnCounter: 5 })
      const obs = await addPerspectiveObservation(ref, {
        content: 'Auth endpoint lacks rate limiting',
        category: 'concern',
        confidence: 0.9,
      })
      expect(obs.id).toMatch(/^pobs_/)
      expect(obs.content).toBe('Auth endpoint lacks rate limiting')
      expect(obs.category).toBe('concern')
      expect(obs.confidence).toBe(0.9)
      expect(obs.addedAt).toBe(5)
      expect(ref.state.observations).toHaveLength(1)
    })

    it('defaults category and confidence when omitted', async () => {
      const ref = createMockObservationsRef()
      const obs = await addPerspectiveObservation(ref, { content: 'test' })
      expect(obs.category).toBe('observation')
      expect(obs.confidence).toBe(0.7)
    })

    it('preserves source when provided', async () => {
      const ref = createMockObservationsRef()
      const obs = await addPerspectiveObservation(ref, {
        content: 'test',
        source: 'analysis-1',
      })
      expect(obs.source).toBe('analysis-1')
    })
  })

  describe('removePerspectiveObservation', () => {
    it('removes an observation by id', async () => {
      const ref = createMockObservationsRef()
      const obs = await addPerspectiveObservation(ref, { content: 'x' })
      const removed = await removePerspectiveObservation(ref, obs.id)
      expect(removed).toBe(true)
      expect(ref.state.observations).toHaveLength(0)
    })

    it('returns false for missing id', async () => {
      const ref = createMockObservationsRef()
      expect(await removePerspectiveObservation(ref, 'nope')).toBe(false)
    })
  })

  describe('perspectiveObservations (accessor)', () => {
    it('returns all observations when no category filter', async () => {
      const ref = createMockObservationsRef()
      await addPerspectiveObservation(ref, { content: 'a', category: 'risk' })
      await addPerspectiveObservation(ref, { content: 'b', category: 'concern' })
      expect(perspectiveObservations(ref)).toHaveLength(2)
    })

    it('filters by category', async () => {
      const ref = createMockObservationsRef()
      await addPerspectiveObservation(ref, { content: 'a', category: 'risk' })
      await addPerspectiveObservation(ref, { content: 'b', category: 'concern' })
      await addPerspectiveObservation(ref, { content: 'c', category: 'risk' })
      const risks = perspectiveObservations(ref, 'risk')
      expect(risks).toHaveLength(2)
      expect(risks.every((o) => o.category === 'risk')).toBe(true)
    })

    it('returns a copy, not the original array', async () => {
      const ref = createMockObservationsRef()
      await addPerspectiveObservation(ref, { content: 'a' })
      const list = perspectiveObservations(ref)
      list.pop()
      expect(ref.state.observations).toHaveLength(1)
    })
  })

  describe('advancePerspectiveObservations', () => {
    it('increments the turn counter', async () => {
      const ref = createMockObservationsRef()
      await advancePerspectiveObservations(ref)
      await advancePerspectiveObservations(ref)
      expect(ref.state.turnCounter).toBe(2)
    })

    it('newer observations get higher addedAt', async () => {
      const ref = createMockObservationsRef()
      const a = await addPerspectiveObservation(ref, { content: 'a' })
      await advancePerspectiveObservations(ref)
      const b = await addPerspectiveObservation(ref, { content: 'b' })
      expect(a.addedAt).toBe(0)
      expect(b.addedAt).toBe(1)
    })
  })

  describe('formatPerspectiveObservations', () => {
    it('returns empty string when no observations', () => {
      const ref = createMockObservationsRef()
      expect(formatPerspectiveObservations(ref)).toBe('')
    })

    it('groups observations by category', async () => {
      const ref = createMockObservationsRef()
      await addPerspectiveObservation(ref, {
        content: 'a', category: 'risk', confidence: 0.8,
      })
      await addPerspectiveObservation(ref, {
        content: 'b', category: 'concern', confidence: 0.6,
      })
      const out = formatPerspectiveObservations(ref)
      expect(out).toContain('**risk:**')
      expect(out).toContain('**concern:**')
      expect(out).toContain('a')
      expect(out).toContain('b')
      expect(out).toContain('0.80')
      expect(out).toContain('0.60')
    })
  })
})

// ---------------------------------------------------------------------------
// Phase B — Position helpers
// ---------------------------------------------------------------------------

describe('identity/perspective — position helpers', () => {
  describe('addPerspectivePosition', () => {
    it('adds a position with generated ID and defaults', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'Auth needs review',
        reasoning: 'Multiple gaps observed',
      })
      expect(pos.id).toMatch(/^ppos_/)
      expect(pos.claim).toBe('Auth needs review')
      expect(pos.confidence).toBe(0.7)
      expect(pos.supportingObservations).toEqual([])
      expect(pos.challenges).toEqual([])
    })

    it('uses observations turn counter for addedAt when provided', async () => {
      const obsRef = createMockObservationsRef({ turnCounter: 10 })
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'c', reasoning: 'r',
      }, obsRef)
      expect(pos.addedAt).toBe(10)
    })

    it('links supporting observations', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'c',
        reasoning: 'r',
        supportingObservations: ['o1', 'o2'],
      })
      expect(pos.supportingObservations).toEqual(['o1', 'o2'])
    })
  })

  describe('challengePerspectivePosition', () => {
    it('appends a challenge to the position', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'c', reasoning: 'r',
      })
      const challenged = await challengePerspectivePosition(posRef, pos.id, 'counter-evidence')
      expect(challenged).toBe(true)
      expect(posRef.state.positions[0].challenges).toHaveLength(1)
      expect(posRef.state.positions[0].challenges[0].evidence).toBe('counter-evidence')
    })

    it('accumulates multiple challenges', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'c', reasoning: 'r',
      })
      await challengePerspectivePosition(posRef, pos.id, 'e1')
      await challengePerspectivePosition(posRef, pos.id, 'e2')
      expect(posRef.state.positions[0].challenges).toHaveLength(2)
    })

    it('returns false for missing position', async () => {
      const posRef = createMockPositionsRef()
      expect(await challengePerspectivePosition(posRef, 'nope', 'e')).toBe(false)
    })
  })

  describe('removePerspectivePosition', () => {
    it('removes a position by id', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, { claim: 'c', reasoning: 'r' })
      expect(await removePerspectivePosition(posRef, pos.id)).toBe(true)
      expect(posRef.state.positions).toHaveLength(0)
    })

    it('returns false for missing id', async () => {
      const posRef = createMockPositionsRef()
      expect(await removePerspectivePosition(posRef, 'nope')).toBe(false)
    })
  })

  describe('perspectivePositions (accessor)', () => {
    it('returns all positions', async () => {
      const posRef = createMockPositionsRef()
      await addPerspectivePosition(posRef, { claim: 'a', reasoning: 'r' })
      await addPerspectivePosition(posRef, { claim: 'b', reasoning: 'r' })
      expect(perspectivePositions(posRef)).toHaveLength(2)
    })
  })

  describe('formatPerspectivePositions', () => {
    it('returns empty string when no positions', () => {
      const posRef = createMockPositionsRef()
      expect(formatPerspectivePositions(posRef)).toBe('')
    })

    it('formats positions with claim, reasoning, and challenges', async () => {
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, {
        claim: 'Auth needs review',
        reasoning: 'observed gaps',
        confidence: 0.85,
      })
      await challengePerspectivePosition(posRef, pos.id, 'newer logs show strong auth')
      const out = formatPerspectivePositions(posRef)
      expect(out).toContain('Auth needs review')
      expect(out).toContain('observed gaps')
      expect(out).toContain('0.85')
      expect(out).toContain('Challenged by')
      expect(out).toContain('newer logs show strong auth')
    })
  })

  describe('formatPerspectiveAccumulated', () => {
    it('returns empty string when both resources are empty', () => {
      const obsRef = createMockObservationsRef()
      const posRef = createMockPositionsRef()
      expect(formatPerspectiveAccumulated(obsRef, posRef)).toBe('')
    })

    it('combines observations and positions sections', async () => {
      const obsRef = createMockObservationsRef()
      const posRef = createMockPositionsRef()
      await addPerspectiveObservation(obsRef, { content: 'obs', category: 'risk', confidence: 0.9 })
      await addPerspectivePosition(posRef, { claim: 'pos', reasoning: 'r' })

      const out = formatPerspectiveAccumulated(obsRef, posRef)
      expect(out).toContain('Observations recorded')
      expect(out).toContain('Positions taken')
      expect(out).toContain('obs')
      expect(out).toContain('pos')
    })

    it('works with only observations (no positions ref)', async () => {
      const obsRef = createMockObservationsRef()
      await addPerspectiveObservation(obsRef, { content: 'x' })
      const out = formatPerspectiveAccumulated(obsRef)
      expect(out).toContain('Observations recorded')
      expect(out).not.toContain('Positions taken')
    })
  })
})

// ---------------------------------------------------------------------------
// Phase B — Blocks: shapes
// ---------------------------------------------------------------------------

describe('identity/perspective — stateful block shapes', () => {
  function i() { return makeInstance() }

  it('perspectiveObserve returns a handler', () => {
    const block = perspectiveObserve({ perspective: i() })
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('security-engineer/observe')
  })

  it('perspectivePosition returns a handler', () => {
    const block = perspectivePosition({ perspective: i() })
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('security-engineer/position')
  })

  it('perspectiveChallenge returns a handler', () => {
    const block = perspectiveChallenge({ perspective: i() })
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('security-engineer/challenge')
  })

  it('perspectiveSnapshot returns a handler', () => {
    const block = perspectiveSnapshot({ perspective: i() })
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('security-engineer/snapshot')
  })

  it('perspectiveAdvance returns a handler', () => {
    const block = perspectiveAdvance({ perspective: i() })
    expect(block.kind).toBe('handler')
    expect(block.name).toBe('security-engineer/advance')
  })

  it('custom names override defaults', () => {
    const block = perspectiveObserve({ name: 'my-observe', perspective: i() })
    expect(block.name).toBe('my-observe')
  })
})

// ---------------------------------------------------------------------------
// Phase B — Blocks: execution
// ---------------------------------------------------------------------------

describe('identity/perspective — block execution', () => {
  describe('perspectiveObserve', () => {
    it('records explicit observations batch', async () => {
      const obsRef = createMockObservationsRef()
      const block = perspectiveObserve({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
      })
      const ctx = makeCtx({ observations: obsRef })
      const result = await block.run({
        observations: [
          { content: 'auth is weak', category: 'risk', confidence: 0.9 },
          { content: 'logs are sparse', category: 'concern' },
        ],
      } as any, ctx)

      expect(result.observations).toHaveLength(2)
      expect(obsRef.state.observations).toHaveLength(2)
      expect(obsRef.state.observations[0].content).toBe('auth is weak')
      expect(obsRef.state.observations[1].category).toBe('concern')
    })

    it('promotes PerspectiveAnalysis salienceNotes to observations', async () => {
      const obsRef = createMockObservationsRef()
      const block = perspectiveObserve({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
      })
      const ctx = makeCtx({ observations: obsRef })
      const analysis = {
        perspectiveName: 'security-engineer',
        analysis: 'full analysis text',
        salienceNotes: ['auth gap', 'input validation missing', 'dependency vuln'],
        recommendations: ['add MFA'],
        confidence: 0.85,
      }
      const result = await block.run(analysis as any, ctx)

      expect(result.observations).toHaveLength(3)
      expect(result.observations[0].content).toBe('auth gap')
      expect(result.observations[0].category).toBe('analysis')
      expect(result.observations[0].confidence).toBe(0.85)
      expect(result.observations[0].source).toBe('security-engineer')
    })
  })

  describe('perspectivePosition', () => {
    it('records a position tied to supporting observations', async () => {
      const obsRef = createMockObservationsRef({ turnCounter: 3 })
      const posRef = createMockPositionsRef()
      const block = perspectivePosition({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
        _positionsResource: perspectivePositionsResource,
      })
      const ctx = makeCtx({ observations: obsRef, positions: posRef })
      const result = await block.run({
        claim: 'Auth needs audit',
        reasoning: 'multiple gaps',
        confidence: 0.85,
        supportingObservations: ['o1', 'o2'],
      } as any, ctx)

      expect(result.id).toMatch(/^ppos_/)
      expect(result.claim).toBe('Auth needs audit')
      expect(result.addedAt).toBe(3)
      expect(posRef.state.positions).toHaveLength(1)
    })
  })

  describe('perspectiveChallenge', () => {
    it('challenges an existing position', async () => {
      const obsRef = createMockObservationsRef()
      const posRef = createMockPositionsRef()
      const pos = await addPerspectivePosition(posRef, { claim: 'c', reasoning: 'r' })

      const block = perspectiveChallenge({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
        _positionsResource: perspectivePositionsResource,
      })
      const ctx = makeCtx({ observations: obsRef, positions: posRef })
      const result = await block.run({
        positionId: pos.id,
        evidence: 'new evidence',
      } as any, ctx)

      expect(result.challenged).toBe(true)
      expect(posRef.state.positions[0].challenges).toHaveLength(1)
    })

    it('reports false when position is missing', async () => {
      const obsRef = createMockObservationsRef()
      const posRef = createMockPositionsRef()
      const block = perspectiveChallenge({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
        _positionsResource: perspectivePositionsResource,
      })
      const ctx = makeCtx({ observations: obsRef, positions: posRef })
      const result = await block.run({
        positionId: 'nope',
        evidence: 'e',
      } as any, ctx)

      expect(result.challenged).toBe(false)
    })
  })

  describe('perspectiveSnapshot', () => {
    it('returns observations + positions + turnCounter', async () => {
      const obsRef = createMockObservationsRef({ turnCounter: 4 })
      const posRef = createMockPositionsRef()
      await addPerspectiveObservation(obsRef, { content: 'a' })
      await addPerspectivePosition(posRef, { claim: 'c', reasoning: 'r' })

      const block = perspectiveSnapshot({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
        _positionsResource: perspectivePositionsResource,
      })
      const ctx = makeCtx({ observations: obsRef, positions: posRef })
      const result = await block.run(undefined as any, ctx)

      expect(result.observations).toHaveLength(1)
      expect(result.positions).toHaveLength(1)
      expect(result.turnCounter).toBe(4)
    })
  })

  describe('perspectiveAdvance', () => {
    it('bumps the turn counter', async () => {
      const obsRef = createMockObservationsRef({ turnCounter: 0 })
      const block = perspectiveAdvance({
        perspective: makeInstance(),
        _observationsResource: perspectiveObservationsResource,
      })
      const ctx = makeCtx({ observations: obsRef })
      await block.run(undefined as any, ctx)
      expect(obsRef.state.turnCounter).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Phase B — Capability
// ---------------------------------------------------------------------------

describe('identity/perspective — createPerspectiveCapability', () => {
  it('returns a capability with the correct name and brand', () => {
    const cap = createPerspectiveCapability(makeInstance())
    expect(cap.__brand).toBe('Capability')
    expect(cap.name).toBe('perspective')
  })

  it('declares session resources for default scope', () => {
    const cap = createPerspectiveCapability(makeInstance())
    expect(cap.sessionResources).toHaveProperty('perspectiveObservations')
    expect(cap.sessionResources).toHaveProperty('perspectivePositions')
    expect(cap.userResources).toBeUndefined()
    expect(cap.projectResources).toBeUndefined()
  })

  it('moves positions to user resources when positionScope is user', () => {
    const cap = createPerspectiveCapability(makeInstance(), { positionScope: 'user' })
    expect(cap.sessionResources).toHaveProperty('perspectiveObservations')
    expect(cap.sessionResources).not.toHaveProperty('perspectivePositions')
    expect(cap.userResources).toHaveProperty('perspectivePositions')
    expect(cap.projectResources).toBeUndefined()
  })

  it('moves positions to project resources when positionScope is project', () => {
    const cap = createPerspectiveCapability(makeInstance(), { positionScope: 'project' })
    expect(cap.sessionResources).toHaveProperty('perspectiveObservations')
    expect(cap.sessionResources).not.toHaveProperty('perspectivePositions')
    expect(cap.userResources).toBeUndefined()
    expect(cap.projectResources).toHaveProperty('perspectivePositions')
  })

  it('declares static and accumulated presets with default enabled', () => {
    const cap = createPerspectiveCapability(makeInstance())
    const presetDefs = (cap as any).__presetDefs
    expect(presetDefs).toHaveProperty('static')
    expect(presetDefs).toHaveProperty('accumulated')
    expect(presetDefs.default).toEqual(['static', 'accumulated'])
  })

  it('fns factory returns typed helpers bound to ctx refs', async () => {
    const instance = makeInstance()
    const cap = createPerspectiveCapability(instance)
    const obsRef = createMockObservationsRef()
    const posRef = createMockPositionsRef()
    const ctx = makeCtx({ observations: obsRef, positions: posRef })

    const helpers = cap.fns!(ctx as any)
    expect(typeof helpers.observe).toBe('function')
    expect(typeof helpers.position).toBe('function')
    expect(typeof helpers.challenge).toBe('function')

    await helpers.observe({ content: 'auth gap', category: 'risk', confidence: 0.9 })
    expect(obsRef.state.observations).toHaveLength(1)

    const pos = await helpers.position({ claim: 'c', reasoning: 'r' })
    expect(posRef.state.positions).toHaveLength(1)

    const challenged = await helpers.challenge(pos.id, 'counter')
    expect(challenged).toBe(true)

    expect(helpers.observations()).toHaveLength(1)
    expect(helpers.observations('risk')).toHaveLength(1)
    expect(helpers.observations('nonexistent')).toHaveLength(0)
    expect(helpers.positions()).toHaveLength(1)
    expect(helpers.instance()).toBe(instance)
  })

  it('static preset context formatter produces perspective framing', () => {
    const instance = makeInstance()
    const cap = createPerspectiveCapability(instance)
    const staticPreset = (cap as any).__presetDefs.static
    const formatter = staticPreset.context[0]
    const output = formatter({}, {})
    expect(output).toContain('# Perspective: security-engineer')
    expect(output).toContain('Salience Model')
  })

  it('accumulated preset formatter reads from resources', async () => {
    const cap = createPerspectiveCapability(makeInstance())
    const obsRef = createMockObservationsRef()
    const posRef = createMockPositionsRef()
    await addPerspectiveObservation(obsRef, { content: 'gap', category: 'risk', confidence: 0.9 })
    const ctx = makeCtx({ observations: obsRef, positions: posRef })

    const accumulated = (cap as any).__presetDefs.accumulated
    const formatter = accumulated.context[0]
    const out = formatter({}, ctx)
    expect(out).toContain('Observations recorded')
    expect(out).toContain('gap')
  })

  it('accumulated preset returns empty when resources are empty', () => {
    const cap = createPerspectiveCapability(makeInstance())
    const ctx = makeCtx({
      observations: createMockObservationsRef(),
      positions: createMockPositionsRef(),
    })
    const accumulated = (cap as any).__presetDefs.accumulated
    const formatter = accumulated.context[0]
    expect(formatter({}, ctx)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Phase B — System factory
// ---------------------------------------------------------------------------

describe('identity/perspective — system() factory', () => {
  it('returns a complete bundle', () => {
    const p = system(makeInstance())
    expect(p.apply.kind).toBe('handler')
    expect(p.analyze.kind).toBe('generator')
    expect(p.auditor.kind).toBe('sequencer')
    expect(p.observe.kind).toBe('handler')
    expect(p.position.kind).toBe('handler')
    expect(p.challenge.kind).toBe('handler')
    expect(p.snapshot.kind).toBe('handler')
    expect(p.advance.kind).toBe('handler')
    expect(p.capture.kind).toBe('sequencer')
    expect(p.capability.__brand).toBe('Capability')
    expect(p.instance.name).toBe('security-engineer')
  })

  it('pre-configures block names from the perspective', () => {
    const p = system(makeInstance())
    expect(p.apply.name).toBe('security-engineer/apply')
    expect(p.analyze.name).toBe('security-engineer/analyze')
    expect(p.capture.name).toBe('security-engineer/capture')
  })

  it('custom name prefix overrides perspective name', () => {
    const p = system(makeInstance(), { name: 'sec-audit' })
    expect(p.apply.name).toBe('sec-audit/apply')
    expect(p.capture.name).toBe('sec-audit/capture')
  })

  it('populates sessionResources for default scope', () => {
    const p = system(makeInstance())
    expect(p.sessionResources).toHaveProperty('perspectiveObservations')
    expect(p.sessionResources).toHaveProperty('perspectivePositions')
    expect(p.userResources).toEqual({})
    expect(p.projectResources).toEqual({})
  })

  it('moves positions to userResources when scope is user', () => {
    const p = system(makeInstance(), { positionScope: 'user' })
    expect(p.sessionResources).toHaveProperty('perspectiveObservations')
    expect(p.sessionResources).not.toHaveProperty('perspectivePositions')
    expect(p.userResources).toHaveProperty('perspectivePositions')
  })

  it('moves positions to projectResources when scope is project', () => {
    const p = system(makeInstance(), { positionScope: 'project' })
    expect(p.projectResources).toHaveProperty('perspectivePositions')
  })

  it('recall reads accumulated state from ctx', async () => {
    const p = system(makeInstance())
    const obsRef = createMockObservationsRef({ turnCounter: 2 })
    const posRef = createMockPositionsRef()
    await addPerspectiveObservation(obsRef, { content: 'x' })
    await addPerspectivePosition(posRef, { claim: 'c', reasoning: 'r' })
    const ctx = makeCtx({ observations: obsRef, positions: posRef })

    const state = p.recall(ctx)
    expect(state.observations).toHaveLength(1)
    expect(state.positions).toHaveLength(1)
    expect(state.turnCounter).toBe(2)
  })

  it('recall returns empty state when resources are missing', () => {
    const p = system(makeInstance())
    const ctx = { session: { resources: {} }, user: { resources: {} }, project: { resources: {} } } as any
    const state = p.recall(ctx)
    expect(state.observations).toEqual([])
    expect(state.positions).toEqual([])
    expect(state.turnCounter).toBe(0)
  })

  it('contextFormatter produces accumulated output', async () => {
    const p = system(makeInstance())
    const obsRef = createMockObservationsRef()
    await addPerspectiveObservation(obsRef, { content: 'obs', category: 'risk', confidence: 0.8 })
    const ctx = makeCtx({
      observations: obsRef,
      positions: createMockPositionsRef(),
    })
    const out = p.contextFormatter({}, ctx)
    expect(out).toContain('obs')
  })

  it('produces distinct capabilities per system() call', () => {
    const p1 = system(makeInstance())
    const p2 = system(makeInstance())
    expect(p1.capability).not.toBe(p2.capability)
  })
})
