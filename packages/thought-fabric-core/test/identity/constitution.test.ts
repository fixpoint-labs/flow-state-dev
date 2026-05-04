import { runForTest } from "@flow-state-dev/testing";
import { describe, it, expect } from 'vitest'
import {
  constitution,
  constitutionPrincipleSchema,
  constitutionContextualOverrideSchema,
  constitutionConflictResolutionSchema,
  constitutionConfigSchema,
  constitutionPrincipleResultSchema,
  constitutionViolationSchema,
  constitutionTradeoffSchema,
  constitutionReviewInputSchema,
  constitutionReviewOutputSchema,
} from '../../src/identity/constitution.js'
import type {
  ConstitutionDefinition,
  ConstitutionPrincipleResult,
  ConstitutionReviewOutput,
} from '../../src/identity/constitution.js'
import {
  DEFAULT_CONSTITUTION_CONFIG,
  rankConstitutionPrinciples,
  computeConstitutionCompliance,
  formatConstitution,
  summarizeConstitutionReview,
} from '../../src/identity/constitution-helpers.js'
import {
  constitutionReview,
  constitutionEnforce,
  constitutionAuditor,
} from '../../src/identity/constitution-blocks.js'

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeConstitution(
  overrides?: Partial<Parameters<typeof constitution>[0]>,
): ConstitutionDefinition {
  return constitution({
    name: 'test-values',
    principles: [
      { id: 'accuracy', statement: 'Provide accurate information', priority: 1, rationale: 'Trust matters' },
      { id: 'clarity', statement: 'Communicate clearly', priority: 2, rationale: 'Clarity aids understanding' },
      { id: 'brevity', statement: 'Be concise', priority: 3 },
    ],
    conflictResolution: 'priority',
    ...overrides,
  })
}

function makeWeightedConstitution(): ConstitutionDefinition {
  return constitution({
    name: 'weighted-values',
    principles: [
      { id: 'accuracy', statement: 'Provide accurate information', priority: 1, weight: 0.5 },
      { id: 'clarity', statement: 'Communicate clearly', priority: 2, weight: 0.3 },
      { id: 'brevity', statement: 'Be concise', priority: 3, weight: 0.2 },
    ],
    conflictResolution: 'weighted',
  })
}

function makeContextualConstitution(): ConstitutionDefinition {
  return constitution({
    name: 'contextual-values',
    principles: [
      { id: 'accuracy', statement: 'Provide accurate information', priority: 1 },
      { id: 'clarity', statement: 'Communicate clearly', priority: 2 },
      { id: 'brevity', statement: 'Be concise', priority: 3 },
      { id: 'completeness', statement: 'Address all aspects', priority: 4 },
    ],
    conflictResolution: 'contextual',
    contextualOverrides: [
      {
        when: 'User explicitly asks for a quick answer',
        promote: 'brevity',
        demote: 'completeness',
        reasoning: 'User signaled preference for speed',
      },
    ],
  })
}

function makePrincipleResult(overrides?: Partial<ConstitutionPrincipleResult>): ConstitutionPrincipleResult {
  return {
    principleId: 'accuracy',
    score: 0.9,
    satisfied: true,
    evidence: 'The content cites sources.',
    reasoning: 'Content is well-sourced and factual.',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('identity/constitution', () => {
  describe('schemas', () => {
    it('constitutionPrincipleSchema validates a complete principle', () => {
      const principle = {
        id: 'accuracy',
        statement: 'Provide accurate information',
        priority: 1,
        rationale: 'Trust matters',
        weight: 0.5,
      }
      expect(constitutionPrincipleSchema.safeParse(principle).success).toBe(true)
    })

    it('constitutionPrincipleSchema accepts optional rationale and weight', () => {
      const principle = {
        id: 'accuracy',
        statement: 'Provide accurate information',
        priority: 1,
      }
      expect(constitutionPrincipleSchema.safeParse(principle).success).toBe(true)
    })

    it('constitutionPrincipleSchema rejects empty id', () => {
      expect(constitutionPrincipleSchema.safeParse({
        id: '',
        statement: 'test',
        priority: 1,
      }).success).toBe(false)
    })

    it('constitutionPrincipleSchema rejects priority < 1', () => {
      expect(constitutionPrincipleSchema.safeParse({
        id: 'test',
        statement: 'test',
        priority: 0,
      }).success).toBe(false)
    })

    it('constitutionPrincipleSchema rejects non-integer priority', () => {
      expect(constitutionPrincipleSchema.safeParse({
        id: 'test',
        statement: 'test',
        priority: 1.5,
      }).success).toBe(false)
    })

    it('constitutionPrincipleSchema rejects weight out of range', () => {
      expect(constitutionPrincipleSchema.safeParse({
        id: 'test',
        statement: 'test',
        priority: 1,
        weight: 1.5,
      }).success).toBe(false)
      expect(constitutionPrincipleSchema.safeParse({
        id: 'test',
        statement: 'test',
        priority: 1,
        weight: -0.1,
      }).success).toBe(false)
    })

    it('constitutionContextualOverrideSchema validates a complete override', () => {
      const override = {
        when: 'User asks for quick answer',
        promote: 'brevity',
        demote: 'completeness',
        reasoning: 'User wants speed',
      }
      expect(constitutionContextualOverrideSchema.safeParse(override).success).toBe(true)
    })

    it('constitutionContextualOverrideSchema rejects missing fields', () => {
      expect(constitutionContextualOverrideSchema.safeParse({
        when: 'test',
      }).success).toBe(false)
    })

    it('constitutionConflictResolutionSchema validates all three modes', () => {
      for (const mode of ['priority', 'weighted', 'contextual']) {
        expect(constitutionConflictResolutionSchema.safeParse(mode).success).toBe(true)
      }
    })

    it('constitutionConflictResolutionSchema rejects unknown modes', () => {
      expect(constitutionConflictResolutionSchema.safeParse('random').success).toBe(false)
    })

    it('constitutionConfigSchema validates a complete config', () => {
      const config = {
        name: 'test',
        principles: [{ id: 'a', statement: 'test', priority: 1 }],
        conflictResolution: 'priority',
        version: '1.0',
      }
      expect(constitutionConfigSchema.safeParse(config).success).toBe(true)
    })

    it('constitutionConfigSchema defaults conflictResolution to priority', () => {
      const config = {
        name: 'test',
        principles: [{ id: 'a', statement: 'test', priority: 1 }],
      }
      const result = constitutionConfigSchema.parse(config)
      expect(result.conflictResolution).toBe('priority')
    })

    it('constitutionConfigSchema requires at least one principle', () => {
      const config = {
        name: 'test',
        principles: [],
      }
      expect(constitutionConfigSchema.safeParse(config).success).toBe(false)
    })

    it('constitutionPrincipleResultSchema validates a complete result', () => {
      expect(constitutionPrincipleResultSchema.safeParse(makePrincipleResult()).success).toBe(true)
    })

    it('constitutionPrincipleResultSchema rejects out-of-range score', () => {
      expect(constitutionPrincipleResultSchema.safeParse(
        makePrincipleResult({ score: 1.5 })
      ).success).toBe(false)
    })

    it('constitutionViolationSchema validates a complete violation', () => {
      const violation = {
        principleId: 'accuracy',
        severity: 'moderate',
        description: 'Unsourced claims',
        evidence: 'No sources cited.',
      }
      expect(constitutionViolationSchema.safeParse(violation).success).toBe(true)
    })

    it('constitutionViolationSchema validates all severity levels', () => {
      for (const severity of ['minor', 'moderate', 'severe']) {
        expect(constitutionViolationSchema.safeParse({
          principleId: 'test',
          severity,
          description: 'test',
          evidence: 'test',
        }).success).toBe(true)
      }
    })

    it('constitutionTradeoffSchema validates a complete tradeoff', () => {
      const tradeoff = {
        promoted: 'brevity',
        demoted: 'completeness',
        reasoning: 'User wanted conciseness',
      }
      expect(constitutionTradeoffSchema.safeParse(tradeoff).success).toBe(true)
    })

    it('constitutionReviewInputSchema validates content with optional context', () => {
      expect(constitutionReviewInputSchema.safeParse({
        content: 'test content',
      }).success).toBe(true)
      expect(constitutionReviewInputSchema.safeParse({
        content: 'test content',
        context: 'quick answer requested',
      }).success).toBe(true)
    })

    it('constitutionReviewInputSchema rejects missing content', () => {
      expect(constitutionReviewInputSchema.safeParse({}).success).toBe(false)
    })

    it('constitutionReviewOutputSchema validates a complete output', () => {
      const output: ConstitutionReviewOutput = {
        compliant: true,
        score: 0.85,
        principleResults: [makePrincipleResult()],
        violations: [],
        tradeoffs: [],
        reasoning: 'All principles satisfied.',
      }
      expect(constitutionReviewOutputSchema.safeParse(output).success).toBe(true)
    })

    it('constitutionReviewOutputSchema validates output with violations', () => {
      const output: ConstitutionReviewOutput = {
        compliant: false,
        score: 0.45,
        principleResults: [makePrincipleResult({ score: 0.4, satisfied: false })],
        violations: [{
          principleId: 'accuracy',
          severity: 'moderate',
          description: 'test',
          evidence: 'test',
        }],
        tradeoffs: [{
          promoted: 'brevity',
          demoted: 'accuracy',
          reasoning: 'test',
        }],
        reasoning: 'Violations detected.',
      }
      expect(constitutionReviewOutputSchema.safeParse(output).success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // constitution() factory
  // ---------------------------------------------------------------------------

  describe('constitution()', () => {
    it('creates a frozen ConstitutionDefinition', () => {
      const def = makeConstitution()
      expect(def.name).toBe('test-values')
      expect(def.principles).toHaveLength(3)
      expect(def.conflictResolution).toBe('priority')
      expect(Object.isFrozen(def)).toBe(true)
    })

    it('freezes principles array and individual principles', () => {
      const def = makeConstitution()
      expect(Object.isFrozen(def.principles)).toBe(true)
      expect(Object.isFrozen(def.principles[0])).toBe(true)
    })

    it('defaults conflictResolution to priority', () => {
      const def = constitution({
        name: 'test',
        principles: [{ id: 'a', statement: 'test', priority: 1 }],
      })
      expect(def.conflictResolution).toBe('priority')
    })

    it('defaults contextualOverrides to empty array', () => {
      const def = makeConstitution()
      expect(def.contextualOverrides).toEqual([])
    })

    it('preserves version when provided', () => {
      const def = makeConstitution({ version: '2.0' })
      expect(def.version).toBe('2.0')
    })

    it('throws on duplicate principle IDs', () => {
      expect(() =>
        constitution({
          name: 'test',
          principles: [
            { id: 'same', statement: 'first', priority: 1 },
            { id: 'same', statement: 'second', priority: 2 },
          ],
        })
      ).toThrow("Duplicate principle ID: 'same'")
    })

    it('throws when weighted mode lacks weights', () => {
      expect(() =>
        constitution({
          name: 'test',
          principles: [
            { id: 'a', statement: 'test', priority: 1 },
          ],
          conflictResolution: 'weighted',
        })
      ).toThrow("must have a weight when conflictResolution is 'weighted'")
    })

    it('accepts weighted mode when all principles have weights', () => {
      const def = makeWeightedConstitution()
      expect(def.conflictResolution).toBe('weighted')
      expect(def.principles.every((p) => p.weight !== undefined)).toBe(true)
    })

    it('throws when contextual mode has no overrides', () => {
      expect(() =>
        constitution({
          name: 'test',
          principles: [
            { id: 'a', statement: 'test', priority: 1 },
          ],
          conflictResolution: 'contextual',
        })
      ).toThrow("requires at least one contextualOverride")
    })

    it('throws when contextual override references unknown promote ID', () => {
      expect(() =>
        constitution({
          name: 'test',
          principles: [
            { id: 'a', statement: 'test', priority: 1 },
            { id: 'b', statement: 'test', priority: 2 },
          ],
          conflictResolution: 'contextual',
          contextualOverrides: [{
            when: 'test',
            promote: 'nonexistent',
            demote: 'b',
            reasoning: 'test',
          }],
        })
      ).toThrow("unknown principle 'nonexistent' in promote")
    })

    it('throws when contextual override references unknown demote ID', () => {
      expect(() =>
        constitution({
          name: 'test',
          principles: [
            { id: 'a', statement: 'test', priority: 1 },
            { id: 'b', statement: 'test', priority: 2 },
          ],
          conflictResolution: 'contextual',
          contextualOverrides: [{
            when: 'test',
            promote: 'a',
            demote: 'nonexistent',
            reasoning: 'test',
          }],
        })
      ).toThrow("unknown principle 'nonexistent' in demote")
    })

    it('accepts valid contextual constitution', () => {
      const def = makeContextualConstitution()
      expect(def.conflictResolution).toBe('contextual')
      expect(def.contextualOverrides).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // rankConstitutionPrinciples
  // ---------------------------------------------------------------------------

  describe('rankConstitutionPrinciples', () => {
    it('sorts by priority ascending for priority mode', () => {
      const def = makeConstitution()
      const ranked = rankConstitutionPrinciples(def)
      expect(ranked.map((p) => p.id)).toEqual(['accuracy', 'clarity', 'brevity'])
    })

    it('sorts by weight descending for weighted mode', () => {
      const def = makeWeightedConstitution()
      const ranked = rankConstitutionPrinciples(def)
      expect(ranked.map((p) => p.id)).toEqual(['accuracy', 'clarity', 'brevity'])
    })

    it('applies contextual overrides when context matches', () => {
      const def = makeContextualConstitution()
      const ranked = rankConstitutionPrinciples(def, 'User explicitly asks for a quick answer')

      const brevityIndex = ranked.findIndex((p) => p.id === 'brevity')
      const completenessIndex = ranked.findIndex((p) => p.id === 'completeness')

      // brevity should be promoted above completeness
      expect(brevityIndex).toBeLessThan(completenessIndex)
    })

    it('does not apply contextual overrides without context', () => {
      const def = makeContextualConstitution()
      const ranked = rankConstitutionPrinciples(def)
      // Without context, falls back to priority ordering
      expect(ranked.map((p) => p.id)).toEqual(['accuracy', 'clarity', 'brevity', 'completeness'])
    })

    it('does not apply overrides when context does not match', () => {
      const def = makeContextualConstitution()
      const ranked = rankConstitutionPrinciples(def, 'unrelated context about weather')
      // No override should fire
      expect(ranked.map((p) => p.id)).toEqual(['accuracy', 'clarity', 'brevity', 'completeness'])
    })

    it('returns a new array without mutating the original', () => {
      const def = makeConstitution()
      const ranked = rankConstitutionPrinciples(def)
      expect(ranked).not.toBe(def.principles)
    })
  })

  // ---------------------------------------------------------------------------
  // computeConstitutionCompliance
  // ---------------------------------------------------------------------------

  describe('computeConstitutionCompliance', () => {
    it('returns 1 for empty results', () => {
      const def = makeConstitution()
      expect(computeConstitutionCompliance([], def)).toBe(1)
    })

    it('uses inverse-priority weighting for priority mode', () => {
      const def = makeConstitution()
      // 3 principles with priorities 1, 2, 3
      // Weights: 3, 2, 1 (maxPriority - priority + 1)
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 1.0 }),  // weight 3
        makePrincipleResult({ principleId: 'clarity', score: 0.5 }),   // weight 2
        makePrincipleResult({ principleId: 'brevity', score: 0.0 }),   // weight 1
      ]
      // Expected: (1.0*3 + 0.5*2 + 0.0*1) / (3+2+1) = (3+1+0)/6 = 4/6 ≈ 0.6667
      const score = computeConstitutionCompliance(results, def)
      expect(score).toBeCloseTo(4 / 6, 4)
    })

    it('uses principle weights for weighted mode', () => {
      const def = makeWeightedConstitution()
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 1.0 }),  // weight 0.5
        makePrincipleResult({ principleId: 'clarity', score: 0.5 }),   // weight 0.3
        makePrincipleResult({ principleId: 'brevity', score: 0.0 }),   // weight 0.2
      ]
      // Expected: (1.0*0.5 + 0.5*0.3 + 0.0*0.2) / (0.5+0.3+0.2) = 0.65/1.0 = 0.65
      const score = computeConstitutionCompliance(results, def)
      expect(score).toBeCloseTo(0.65, 4)
    })

    it('clamps result to [0, 1]', () => {
      const def = makeConstitution()
      const allZero = [
        makePrincipleResult({ principleId: 'accuracy', score: 0 }),
        makePrincipleResult({ principleId: 'clarity', score: 0 }),
        makePrincipleResult({ principleId: 'brevity', score: 0 }),
      ]
      expect(computeConstitutionCompliance(allZero, def)).toBeGreaterThanOrEqual(0)

      const allMax = [
        makePrincipleResult({ principleId: 'accuracy', score: 1 }),
        makePrincipleResult({ principleId: 'clarity', score: 1 }),
        makePrincipleResult({ principleId: 'brevity', score: 1 }),
      ]
      expect(computeConstitutionCompliance(allMax, def)).toBeLessThanOrEqual(1)
    })

    it('returns 0 when all scores are 0', () => {
      const def = makeConstitution()
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0 }),
        makePrincipleResult({ principleId: 'clarity', score: 0 }),
        makePrincipleResult({ principleId: 'brevity', score: 0 }),
      ]
      expect(computeConstitutionCompliance(results, def)).toBe(0)
    })

    it('returns 1 when all scores are 1', () => {
      const def = makeConstitution()
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 1 }),
        makePrincipleResult({ principleId: 'clarity', score: 1 }),
        makePrincipleResult({ principleId: 'brevity', score: 1 }),
      ]
      expect(computeConstitutionCompliance(results, def)).toBe(1)
    })

    it('handles results with unknown principle IDs gracefully', () => {
      const def = makeConstitution()
      const results = [
        makePrincipleResult({ principleId: 'unknown', score: 0.5 }),
      ]
      // Unknown principle gets default weight of 1
      expect(computeConstitutionCompliance(results, def)).toBeCloseTo(0.5, 4)
    })
  })

  // ---------------------------------------------------------------------------
  // formatConstitution
  // ---------------------------------------------------------------------------

  describe('formatConstitution', () => {
    it('includes constitution name', () => {
      const def = makeConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).toContain('Constitution: test-values')
    })

    it('includes conflict resolution mode', () => {
      const def = makeConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).toContain('Conflict resolution: priority')
    })

    it('lists principles in priority order', () => {
      const def = makeConstitution()
      const formatted = formatConstitution(def)
      const accuracyPos = formatted.indexOf('Provide accurate information')
      const clarityPos = formatted.indexOf('Communicate clearly')
      const brevityPos = formatted.indexOf('Be concise')
      expect(accuracyPos).toBeLessThan(clarityPos)
      expect(clarityPos).toBeLessThan(brevityPos)
    })

    it('includes rationale when present', () => {
      const def = makeConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).toContain('Rationale: Trust matters')
      expect(formatted).toContain('Rationale: Clarity aids understanding')
    })

    it('includes weights for weighted mode', () => {
      const def = makeWeightedConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).toContain('[weight: 0.5]')
      expect(formatted).toContain('[weight: 0.3]')
    })

    it('includes contextual overrides', () => {
      const def = makeContextualConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).toContain('Contextual overrides:')
      expect(formatted).toContain('User explicitly asks for a quick answer')
      expect(formatted).toContain('Promote: brevity')
    })

    it('includes version when present', () => {
      const def = makeConstitution({ version: '2.0' })
      const formatted = formatConstitution(def)
      expect(formatted).toContain('Version: 2.0')
    })

    it('does not include version when absent', () => {
      const def = makeConstitution()
      const formatted = formatConstitution(def)
      expect(formatted).not.toContain('Version:')
    })
  })

  // ---------------------------------------------------------------------------
  // summarizeConstitutionReview
  // ---------------------------------------------------------------------------

  describe('summarizeConstitutionReview', () => {
    it('reports pass when no violations', () => {
      const review: ConstitutionReviewOutput = {
        compliant: true,
        score: 0.92,
        principleResults: [makePrincipleResult()],
        violations: [],
        tradeoffs: [],
        reasoning: 'All good.',
      }
      const summary = summarizeConstitutionReview(review)
      expect(summary).toContain('passed')
      expect(summary).toContain('0.92')
      expect(summary).toContain('All principles satisfied')
    })

    it('reports failure with violation count', () => {
      const review: ConstitutionReviewOutput = {
        compliant: false,
        score: 0.45,
        principleResults: [makePrincipleResult({ score: 0.4, satisfied: false })],
        violations: [{
          principleId: 'accuracy',
          severity: 'moderate',
          description: 'test',
          evidence: 'test',
        }],
        tradeoffs: [],
        reasoning: 'Failed.',
      }
      const summary = summarizeConstitutionReview(review)
      expect(summary).toContain('failed')
      expect(summary).toContain('1 violation')
      expect(summary).toContain('accuracy')
    })

    it('reports pass with caveats when compliant but with violations', () => {
      const review: ConstitutionReviewOutput = {
        compliant: true,
        score: 0.75,
        principleResults: [makePrincipleResult()],
        violations: [{
          principleId: 'brevity',
          severity: 'minor',
          description: 'test',
          evidence: 'test',
        }],
        tradeoffs: [],
        reasoning: 'Mostly good.',
      }
      const summary = summarizeConstitutionReview(review)
      expect(summary).toContain('passed with caveats')
    })

    it('counts severe and moderate violations', () => {
      const review: ConstitutionReviewOutput = {
        compliant: false,
        score: 0.3,
        principleResults: [],
        violations: [
          { principleId: 'a', severity: 'severe', description: 't', evidence: 't' },
          { principleId: 'b', severity: 'moderate', description: 't', evidence: 't' },
          { principleId: 'c', severity: 'minor', description: 't', evidence: 't' },
        ],
        tradeoffs: [],
        reasoning: 'Bad.',
      }
      const summary = summarizeConstitutionReview(review)
      expect(summary).toContain('1 severe')
      expect(summary).toContain('1 moderate')
    })

    it('reports tradeoff count', () => {
      const review: ConstitutionReviewOutput = {
        compliant: false,
        score: 0.5,
        principleResults: [],
        violations: [
          { principleId: 'a', severity: 'minor', description: 't', evidence: 't' },
        ],
        tradeoffs: [
          { promoted: 'brevity', demoted: 'completeness', reasoning: 'test' },
          { promoted: 'accuracy', demoted: 'clarity', reasoning: 'test' },
        ],
        reasoning: 'Tradeoffs.',
      }
      const summary = summarizeConstitutionReview(review)
      expect(summary).toContain('2 tradeoffs')
    })

    it('deduplicates violation principle IDs', () => {
      const review: ConstitutionReviewOutput = {
        compliant: false,
        score: 0.4,
        principleResults: [],
        violations: [
          { principleId: 'accuracy', severity: 'moderate', description: 't', evidence: 't' },
          { principleId: 'accuracy', severity: 'minor', description: 't2', evidence: 't2' },
        ],
        tradeoffs: [],
        reasoning: 'test',
      }
      const summary = summarizeConstitutionReview(review)
      // Should list 'accuracy' once in the principle ID list
      const afterDetected = summary.split('detected in: ')[1] ?? ''
      const accuracyMatches = afterDetected.split('accuracy')
      expect(accuracyMatches.length - 1).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  describe('defaults', () => {
    it('DEFAULT_CONSTITUTION_CONFIG has expected values', () => {
      expect(DEFAULT_CONSTITUTION_CONFIG.complianceThreshold).toBe(0.7)
    })
  })

  // ---------------------------------------------------------------------------
  // Block shapes
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    const def = makeConstitution()

    describe('constitutionReview', () => {
      it('returns a generator BlockDefinition', () => {
        const block = constitutionReview({ constitution: def })
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = constitutionReview({ constitution: def })
        expect(block.name).toBe('constitution/review')
      })

      it('accepts custom name', () => {
        const block = constitutionReview({ constitution: def, name: 'custom/review' })
        expect(block.name).toBe('custom/review')
      })
    })

    describe('constitutionEnforce', () => {
      it('returns a handler BlockDefinition', () => {
        const block = constitutionEnforce({ constitution: def })
        expect(block.kind).toBe('handler')
      })

      it('has correct default name', () => {
        const block = constitutionEnforce({ constitution: def })
        expect(block.name).toBe('constitution/enforce')
      })

      it('accepts custom name', () => {
        const block = constitutionEnforce({ constitution: def, name: 'custom/enforce' })
        expect(block.name).toBe('custom/enforce')
      })
    })

    describe('constitutionAuditor', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = constitutionAuditor({ constitution: def })
        expect(block.kind).toBe('sequencer')
      })

      it('has correct default name', () => {
        const block = constitutionAuditor({ constitution: def })
        expect(block.name).toBe('constitution')
      })

      it('accepts custom name prefix', () => {
        const block = constitutionAuditor({ constitution: def, name: 'my-auditor' })
        expect(block.name).toBe('my-auditor')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Handler block execution: constitutionEnforce
  // ---------------------------------------------------------------------------

  describe('constitutionEnforce (execution)', () => {
    async function runEnforce(
      principleResults: ConstitutionPrincipleResult[],
      violations: ConstitutionReviewOutput['violations'] = [],
      tradeoffs: ConstitutionReviewOutput['tradeoffs'] = [],
      constitutionDef?: ConstitutionDefinition,
      threshold?: number,
    ) {
      const def = constitutionDef ?? makeConstitution()
      const block = constitutionEnforce({ constitution: def, complianceThreshold: threshold })
      const ctx = { response: { emit: async () => {} } } as any

      return runForTest(block, {
        principleResults,
        violations,
        tradeoffs,
        reasoning: 'test reasoning',
      } as any, ctx)
    }

    it('marks compliant when score >= threshold and no severe violations', async () => {
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0.9 }),
        makePrincipleResult({ principleId: 'clarity', score: 0.8 }),
        makePrincipleResult({ principleId: 'brevity', score: 0.7 }),
      ]
      const result = await runEnforce(results)
      expect(result.compliant).toBe(true)
      expect(result.score).toBeGreaterThanOrEqual(0.7)
    })

    it('marks non-compliant when score < threshold', async () => {
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0.3 }),
        makePrincipleResult({ principleId: 'clarity', score: 0.2 }),
        makePrincipleResult({ principleId: 'brevity', score: 0.1 }),
      ]
      const result = await runEnforce(results)
      expect(result.compliant).toBe(false)
      expect(result.score).toBeLessThan(0.7)
    })

    it('marks non-compliant when severe violation exists even with high score', async () => {
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0.9 }),
        makePrincipleResult({ principleId: 'clarity', score: 0.9 }),
        makePrincipleResult({ principleId: 'brevity', score: 0.9 }),
      ]
      const violations = [{
        principleId: 'accuracy',
        severity: 'severe' as const,
        description: 'Critical failure',
        evidence: 'test',
      }]
      const result = await runEnforce(results, violations)
      expect(result.compliant).toBe(false)
    })

    it('respects custom compliance threshold', async () => {
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0.6 }),
        makePrincipleResult({ principleId: 'clarity', score: 0.5 }),
        makePrincipleResult({ principleId: 'brevity', score: 0.5 }),
      ]
      // Default threshold (0.7) would fail, but 0.4 should pass
      const result = await runEnforce(results, [], [], undefined, 0.4)
      expect(result.compliant).toBe(true)
    })

    it('passes through principleResults, violations, tradeoffs, and reasoning', async () => {
      const results = [makePrincipleResult()]
      const violations = [{
        principleId: 'accuracy',
        severity: 'minor' as const,
        description: 'test',
        evidence: 'test',
      }]
      const tradeoffs = [{
        promoted: 'brevity',
        demoted: 'accuracy',
        reasoning: 'test',
      }]
      const result = await runEnforce(results, violations, tradeoffs)
      expect(result.principleResults).toEqual(results)
      expect(result.violations).toEqual(violations)
      expect(result.tradeoffs).toEqual(tradeoffs)
      expect(result.reasoning).toBe('test reasoning')
    })

    it('uses weighted scoring for weighted constitution', async () => {
      const def = makeWeightedConstitution()
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 1.0 }),  // weight 0.5
        makePrincipleResult({ principleId: 'clarity', score: 0.5 }),   // weight 0.3
        makePrincipleResult({ principleId: 'brevity', score: 0.0 }),   // weight 0.2
      ]
      const result = await runEnforce(results, [], [], def)
      // Expected: (1.0*0.5 + 0.5*0.3 + 0.0*0.2) / (0.5+0.3+0.2) = 0.65
      expect(result.score).toBeCloseTo(0.65, 4)
    })

    it('output validates against constitutionReviewOutputSchema', async () => {
      const results = [
        makePrincipleResult({ principleId: 'accuracy', score: 0.9 }),
        makePrincipleResult({ principleId: 'clarity', score: 0.8 }),
        makePrincipleResult({ principleId: 'brevity', score: 0.7 }),
      ]
      const result = await runEnforce(results)
      expect(constitutionReviewOutputSchema.safeParse(result).success).toBe(true)
    })
  })
})
