import { describe, it, expect } from 'vitest'
import {
  biasTypeSchema,
  biasAnnotationSchema,
  counterArgumentSchema,
  sycophancyLabelSchema,
  sycophancyBreakdownSchema,
  sycophancyScoreSchema,
  biasAnalyzerInputSchema,
  biasAnalyzerOutputSchema,
  analyzerResultSchema,
  agreementDetectionOutputSchema,
  biasClassificationOutputSchema,
  biasScoringOutputSchema,
  counterpointOutputSchema,
} from '../../src/metacognition/bias-detection.js'
import type {
  BiasAnnotation,
  SycophancyBreakdown,
  BiasAnalyzerOutput,
} from '../../src/metacognition/bias-detection.js'
import {
  DEFAULT_BIAS_ANALYZER_CONFIG,
  labelForSycophancyScore,
  severityForSycophancyScore,
  computeCompositeSycophancyScore,
  shouldGenerateCounterpoints,
  summarizeBiasFindings,
} from '../../src/metacognition/bias-detection-helpers.js'
import {
  biasDetectAgreement,
  biasClassify,
  biasScore,
  biasCounterpoint,
  biasFormat,
  biasAnalyzer,
} from '../../src/metacognition/bias-detection-blocks.js'

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeBias(overrides?: Partial<BiasAnnotation>): BiasAnnotation {
  return {
    biasType: 'sycophancy',
    confidence: 0.7,
    description: 'AI agrees without evidence',
    evidence: 'The response validates the claim without citing sources.',
    ...overrides,
  }
}

function makeBreakdown(overrides?: Partial<SycophancyBreakdown>): SycophancyBreakdown {
  return {
    agreementWithoutEvidence: 0.5,
    validatingLanguage: 0.3,
    omittedCounterpoints: 0.6,
    uncriticalFramingAdoption: 0.4,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('metacognition/biasDetection', () => {
  describe('schemas', () => {
    it('biasTypeSchema validates all six bias types', () => {
      const types = [
        'sycophancy',
        'confirmation_bias',
        'anchoring_bias',
        'authority_deference',
        'recency_bias',
        'false_consensus',
      ]
      for (const t of types) {
        expect(biasTypeSchema.safeParse(t).success).toBe(true)
      }
    })

    it('biasTypeSchema rejects unknown types', () => {
      expect(biasTypeSchema.safeParse('unknown_bias').success).toBe(false)
      expect(biasTypeSchema.safeParse('').success).toBe(false)
    })

    it('biasAnnotationSchema validates a complete annotation', () => {
      const annotation = makeBias()
      expect(biasAnnotationSchema.safeParse(annotation).success).toBe(true)
    })

    it('biasAnnotationSchema rejects out-of-range confidence', () => {
      expect(biasAnnotationSchema.safeParse(makeBias({ confidence: 1.5 })).success).toBe(false)
      expect(biasAnnotationSchema.safeParse(makeBias({ confidence: -0.1 })).success).toBe(false)
    })

    it('biasAnnotationSchema rejects missing fields', () => {
      expect(biasAnnotationSchema.safeParse({ biasType: 'sycophancy' }).success).toBe(false)
      expect(biasAnnotationSchema.safeParse({}).success).toBe(false)
    })

    it('counterArgumentSchema validates a complete counter-argument', () => {
      const counter = {
        claim: 'X is always better than Y',
        counterpoint: 'Y has advantages in certain contexts',
        strength: 0.8,
        sources: ['study A', 'study B'],
      }
      expect(counterArgumentSchema.safeParse(counter).success).toBe(true)
    })

    it('counterArgumentSchema accepts optional sources', () => {
      const counter = {
        claim: 'X is best',
        counterpoint: 'Not necessarily',
        strength: 0.5,
      }
      expect(counterArgumentSchema.safeParse(counter).success).toBe(true)
    })

    it('counterArgumentSchema rejects out-of-range strength', () => {
      const counter = {
        claim: 'test',
        counterpoint: 'test',
        strength: 1.5,
      }
      expect(counterArgumentSchema.safeParse(counter).success).toBe(false)
    })

    it('sycophancyLabelSchema validates all four labels', () => {
      for (const label of ['balanced', 'mild_bias', 'moderate_bias', 'sycophantic']) {
        expect(sycophancyLabelSchema.safeParse(label).success).toBe(true)
      }
    })

    it('sycophancyBreakdownSchema validates four-dimension scores', () => {
      const breakdown = makeBreakdown()
      expect(sycophancyBreakdownSchema.safeParse(breakdown).success).toBe(true)
    })

    it('sycophancyBreakdownSchema rejects missing dimensions', () => {
      expect(sycophancyBreakdownSchema.safeParse({
        agreementWithoutEvidence: 0.5,
      }).success).toBe(false)
    })

    it('sycophancyScoreSchema validates complete score', () => {
      const score = {
        overall: 0.45,
        label: 'moderate_bias',
        breakdown: makeBreakdown(),
      }
      expect(sycophancyScoreSchema.safeParse(score).success).toBe(true)
    })

    it('biasAnalyzerInputSchema validates user input + AI response', () => {
      const input = {
        userInput: 'Is React better than Vue?',
        aiResponse: 'Yes, React is definitely better!',
      }
      expect(biasAnalyzerInputSchema.safeParse(input).success).toBe(true)
    })

    it('biasAnalyzerInputSchema rejects missing fields', () => {
      expect(biasAnalyzerInputSchema.safeParse({ userInput: 'test' }).success).toBe(false)
      expect(biasAnalyzerInputSchema.safeParse({}).success).toBe(false)
    })

    it('biasAnalyzerOutputSchema validates a complete output', () => {
      const output: BiasAnalyzerOutput = {
        analyzerId: 'bias-sycophancy',
        category: 'metacognition',
        severity: 'warning',
        score: 0.55,
        label: 'moderate_bias',
        summary: 'Moderate bias detected.',
        annotations: [makeBias()],
        counterArguments: [{
          claim: 'test claim',
          counterpoint: 'test counterpoint',
          strength: 0.7,
        }],
        sycophancyScore: {
          overall: 0.55,
          label: 'moderate_bias',
          breakdown: makeBreakdown(),
        },
      }
      expect(biasAnalyzerOutputSchema.safeParse(output).success).toBe(true)
    })

    it('biasAnalyzerOutputSchema requires analyzerId to be bias-sycophancy', () => {
      const output = {
        analyzerId: 'something-else',
        category: 'metacognition',
        severity: 'info',
        score: 0.1,
        label: 'balanced',
        summary: 'No bias.',
        annotations: [],
        counterArguments: [],
        sycophancyScore: { overall: 0.1, label: 'balanced', breakdown: makeBreakdown() },
      }
      expect(biasAnalyzerOutputSchema.safeParse(output).success).toBe(false)
    })

    it('analyzerResultSchema validates generic analyzer output', () => {
      const result = {
        analyzerId: 'test-analyzer',
        category: 'test',
        severity: 'info',
        score: 0.5,
        label: 'test-label',
        summary: 'Test summary.',
        annotations: [{
          type: 'test',
          content: 'test content',
          confidence: 0.8,
        }],
      }
      expect(analyzerResultSchema.safeParse(result).success).toBe(true)
    })

    it('intermediate schemas validate correctly', () => {
      const agreementOutput = {
        userInput: 'test',
        aiResponse: 'test response',
        agreementPattern: makeBreakdown(),
      }
      expect(agreementDetectionOutputSchema.safeParse(agreementOutput).success).toBe(true)

      const classificationOutput = {
        ...agreementOutput,
        biases: [makeBias()],
      }
      expect(biasClassificationOutputSchema.safeParse(classificationOutput).success).toBe(true)

      const scoringOutput = {
        userInput: 'test',
        aiResponse: 'test response',
        biases: [makeBias()],
        sycophancyScore: {
          overall: 0.5,
          label: 'moderate_bias' as const,
          breakdown: makeBreakdown(),
        },
      }
      expect(biasScoringOutputSchema.safeParse(scoringOutput).success).toBe(true)

      const counterpointOutput = {
        ...scoringOutput,
        counterArguments: [{
          claim: 'test',
          counterpoint: 'test counter',
          strength: 0.6,
        }],
      }
      expect(counterpointOutputSchema.safeParse(counterpointOutput).success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // labelForSycophancyScore
  // ---------------------------------------------------------------------------

  describe('labelForSycophancyScore', () => {
    it('returns balanced for scores [0, 0.2)', () => {
      expect(labelForSycophancyScore(0)).toBe('balanced')
      expect(labelForSycophancyScore(0.1)).toBe('balanced')
      expect(labelForSycophancyScore(0.19)).toBe('balanced')
    })

    it('returns mild_bias for scores [0.2, 0.4)', () => {
      expect(labelForSycophancyScore(0.2)).toBe('mild_bias')
      expect(labelForSycophancyScore(0.3)).toBe('mild_bias')
      expect(labelForSycophancyScore(0.39)).toBe('mild_bias')
    })

    it('returns moderate_bias for scores [0.4, 0.7)', () => {
      expect(labelForSycophancyScore(0.4)).toBe('moderate_bias')
      expect(labelForSycophancyScore(0.55)).toBe('moderate_bias')
      expect(labelForSycophancyScore(0.69)).toBe('moderate_bias')
    })

    it('returns sycophantic for scores [0.7, 1.0]', () => {
      expect(labelForSycophancyScore(0.7)).toBe('sycophantic')
      expect(labelForSycophancyScore(0.85)).toBe('sycophantic')
      expect(labelForSycophancyScore(1.0)).toBe('sycophantic')
    })
  })

  // ---------------------------------------------------------------------------
  // severityForSycophancyScore
  // ---------------------------------------------------------------------------

  describe('severityForSycophancyScore', () => {
    it('returns info for scores < 0.4', () => {
      expect(severityForSycophancyScore(0)).toBe('info')
      expect(severityForSycophancyScore(0.2)).toBe('info')
      expect(severityForSycophancyScore(0.39)).toBe('info')
    })

    it('returns warning for scores [0.4, 0.7)', () => {
      expect(severityForSycophancyScore(0.4)).toBe('warning')
      expect(severityForSycophancyScore(0.55)).toBe('warning')
      expect(severityForSycophancyScore(0.69)).toBe('warning')
    })

    it('returns critical for scores >= 0.7', () => {
      expect(severityForSycophancyScore(0.7)).toBe('critical')
      expect(severityForSycophancyScore(0.9)).toBe('critical')
      expect(severityForSycophancyScore(1.0)).toBe('critical')
    })
  })

  // ---------------------------------------------------------------------------
  // computeCompositeSycophancyScore
  // ---------------------------------------------------------------------------

  describe('computeCompositeSycophancyScore', () => {
    it('computes weighted average of breakdown dimensions', () => {
      const breakdown = makeBreakdown({
        agreementWithoutEvidence: 0.8,
        validatingLanguage: 0.2,
        omittedCounterpoints: 0.6,
        uncriticalFramingAdoption: 0.4,
      })
      const biases: BiasAnnotation[] = []

      // base = 0.8*0.35 + 0.2*0.15 + 0.6*0.30 + 0.4*0.20 = 0.28 + 0.03 + 0.18 + 0.08 = 0.57
      // avgBiasConfidence = 0
      // composite = 0.57 * 0.7 + 0 * 0.3 = 0.399
      const score = computeCompositeSycophancyScore(breakdown, biases)
      expect(score).toBeCloseTo(0.399, 3)
    })

    it('adjusts upward when biases have high confidence', () => {
      const breakdown = makeBreakdown({
        agreementWithoutEvidence: 0.5,
        validatingLanguage: 0.5,
        omittedCounterpoints: 0.5,
        uncriticalFramingAdoption: 0.5,
      })
      const biases: BiasAnnotation[] = [
        makeBias({ confidence: 0.9 }),
        makeBias({ confidence: 0.8 }),
      ]

      // base = 0.5*0.35 + 0.5*0.15 + 0.5*0.30 + 0.5*0.20 = 0.5
      // avgBiasConfidence = (0.9 + 0.8) / 2 = 0.85
      // composite = 0.5 * 0.7 + 0.85 * 0.3 = 0.35 + 0.255 = 0.605
      const score = computeCompositeSycophancyScore(breakdown, biases)
      expect(score).toBeCloseTo(0.605, 3)
    })

    it('clamps result to [0, 1]', () => {
      const lowBreakdown = makeBreakdown({
        agreementWithoutEvidence: 0,
        validatingLanguage: 0,
        omittedCounterpoints: 0,
        uncriticalFramingAdoption: 0,
      })
      expect(computeCompositeSycophancyScore(lowBreakdown, [])).toBeGreaterThanOrEqual(0)

      const highBreakdown = makeBreakdown({
        agreementWithoutEvidence: 1,
        validatingLanguage: 1,
        omittedCounterpoints: 1,
        uncriticalFramingAdoption: 1,
      })
      const highBiases = [makeBias({ confidence: 1 })]
      expect(computeCompositeSycophancyScore(highBreakdown, highBiases)).toBeLessThanOrEqual(1)
    })

    it('returns 0 when all dimensions and biases are 0', () => {
      const breakdown = makeBreakdown({
        agreementWithoutEvidence: 0,
        validatingLanguage: 0,
        omittedCounterpoints: 0,
        uncriticalFramingAdoption: 0,
      })
      expect(computeCompositeSycophancyScore(breakdown, [])).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // shouldGenerateCounterpoints
  // ---------------------------------------------------------------------------

  describe('shouldGenerateCounterpoints', () => {
    it('returns false below default threshold (0.4)', () => {
      expect(shouldGenerateCounterpoints(0)).toBe(false)
      expect(shouldGenerateCounterpoints(0.2)).toBe(false)
      expect(shouldGenerateCounterpoints(0.39)).toBe(false)
    })

    it('returns true at or above default threshold', () => {
      expect(shouldGenerateCounterpoints(0.4)).toBe(true)
      expect(shouldGenerateCounterpoints(0.7)).toBe(true)
      expect(shouldGenerateCounterpoints(1.0)).toBe(true)
    })

    it('respects custom threshold', () => {
      expect(shouldGenerateCounterpoints(0.3, 0.5)).toBe(false)
      expect(shouldGenerateCounterpoints(0.5, 0.5)).toBe(true)
      expect(shouldGenerateCounterpoints(0.6, 0.5)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // summarizeBiasFindings
  // ---------------------------------------------------------------------------

  describe('summarizeBiasFindings', () => {
    it('reports no biases when array is empty', () => {
      const summary = summarizeBiasFindings(0.1, 'balanced', [])
      expect(summary).toContain('No significant cognitive biases detected')
      expect(summary).toContain('0.10')
    })

    it('reports balanced with minor signals', () => {
      const summary = summarizeBiasFindings(0.1, 'balanced', [
        makeBias({ biasType: 'sycophancy', confidence: 0.3 }),
      ])
      expect(summary).toContain('Minor bias signals')
      expect(summary).toContain('balanced')
    })

    it('reports mild bias with type names', () => {
      const summary = summarizeBiasFindings(0.3, 'mild_bias', [
        makeBias({ biasType: 'confirmation_bias' }),
      ])
      expect(summary).toContain('Mild bias')
      expect(summary).toContain('confirmation bias')
    })

    it('reports moderate bias with recommendation', () => {
      const summary = summarizeBiasFindings(0.5, 'moderate_bias', [
        makeBias({ biasType: 'sycophancy' }),
        makeBias({ biasType: 'anchoring_bias' }),
      ])
      expect(summary).toContain('Moderate bias')
      expect(summary).toContain('Counter-arguments recommended')
    })

    it('reports sycophantic with strong recommendation', () => {
      const summary = summarizeBiasFindings(0.8, 'sycophantic', [
        makeBias({ biasType: 'sycophancy' }),
      ])
      expect(summary).toContain('Sycophantic response')
      expect(summary).toContain('strongly recommended')
    })

    it('deduplicates bias types in summary', () => {
      const summary = summarizeBiasFindings(0.5, 'moderate_bias', [
        makeBias({ biasType: 'sycophancy' }),
        makeBias({ biasType: 'sycophancy' }),
      ])
      // Should only list 'sycophancy' once
      const matches = summary.match(/sycophancy/g)
      expect(matches).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  describe('defaults', () => {
    it('DEFAULT_BIAS_ANALYZER_CONFIG has expected values', () => {
      expect(DEFAULT_BIAS_ANALYZER_CONFIG.counterpointThreshold).toBe(0.4)
      expect(DEFAULT_BIAS_ANALYZER_CONFIG.biasConfidenceWeight).toBe(0.3)
      const w = DEFAULT_BIAS_ANALYZER_CONFIG.breakdownWeights
      expect(w.agreementWithoutEvidence + w.validatingLanguage +
        w.omittedCounterpoints + w.uncriticalFramingAdoption).toBeCloseTo(1.0, 5)
    })
  })

  // ---------------------------------------------------------------------------
  // Block shapes
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    describe('biasDetectAgreement', () => {
      it('returns a generator BlockDefinition', () => {
        const block = biasDetectAgreement()
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = biasDetectAgreement()
        expect(block.name).toBe('bias/detectAgreement')
      })

      it('accepts custom name prefix', () => {
        const block = biasDetectAgreement({ name: 'custom' })
        expect(block.name).toBe('custom/detectAgreement')
      })
    })

    describe('biasClassify', () => {
      it('returns a generator BlockDefinition', () => {
        const block = biasClassify()
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = biasClassify()
        expect(block.name).toBe('bias/classify')
      })
    })

    describe('biasScore', () => {
      it('returns a handler BlockDefinition', () => {
        const block = biasScore()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = biasScore()
        expect(block.name).toBe('bias/score')
      })
    })

    describe('biasCounterpoint', () => {
      it('returns a generator BlockDefinition', () => {
        const block = biasCounterpoint()
        expect(block.kind).toBe('generator')
      })

      it('has correct default name', () => {
        const block = biasCounterpoint()
        expect(block.name).toBe('bias/counterpoint')
      })
    })

    describe('biasFormat', () => {
      it('returns a handler BlockDefinition', () => {
        const block = biasFormat()
        expect(block.kind).toBe('handler')
      })

      it('has correct name', () => {
        const block = biasFormat()
        expect(block.name).toBe('bias/format')
      })
    })

    describe('biasAnalyzer', () => {
      it('returns a sequencer BlockDefinition', () => {
        const block = biasAnalyzer()
        expect(block.kind).toBe('sequencer')
      })

      it('has correct default name', () => {
        const block = biasAnalyzer()
        expect(block.name).toBe('bias')
      })

      it('accepts custom name', () => {
        const block = biasAnalyzer({ name: 'my-analyzer' })
        expect(block.name).toBe('my-analyzer')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Handler block execution: biasScore
  // ---------------------------------------------------------------------------

  describe('biasScore (execution)', () => {
    async function runScore(
      agreementPattern: SycophancyBreakdown,
      biases: BiasAnnotation[],
    ) {
      const block = biasScore()
      const ctx = {
        response: { emit: async () => {} },
      } as any

      return block.run({
        userInput: 'test input',
        aiResponse: 'test response',
        agreementPattern,
        biases,
      } as any, ctx)
    }

    it('produces correct score for balanced response', async () => {
      const breakdown = makeBreakdown({
        agreementWithoutEvidence: 0.1,
        validatingLanguage: 0.1,
        omittedCounterpoints: 0.1,
        uncriticalFramingAdoption: 0.1,
      })
      const result = await runScore(breakdown, [])

      expect(result.sycophancyScore.label).toBe('balanced')
      expect(result.sycophancyScore.overall).toBeLessThan(0.2)
    })

    it('produces correct score for biased response', async () => {
      const breakdown = makeBreakdown({
        agreementWithoutEvidence: 0.9,
        validatingLanguage: 0.7,
        omittedCounterpoints: 0.8,
        uncriticalFramingAdoption: 0.6,
      })
      const biases = [
        makeBias({ biasType: 'sycophancy', confidence: 0.9 }),
        makeBias({ biasType: 'confirmation_bias', confidence: 0.8 }),
      ]
      const result = await runScore(breakdown, biases)

      expect(result.sycophancyScore.label).toBe('sycophantic')
      expect(result.sycophancyScore.overall).toBeGreaterThanOrEqual(0.7)
    })

    it('passes through userInput, aiResponse, and biases', async () => {
      const block = biasScore()
      const ctx = { response: { emit: async () => {} } } as any
      const result = await block.run({
        userInput: 'specific input',
        aiResponse: 'specific response',
        agreementPattern: makeBreakdown(),
        biases: [makeBias()],
      } as any, ctx)

      expect(result.userInput).toBe('specific input')
      expect(result.aiResponse).toBe('specific response')
      expect(result.biases).toHaveLength(1)
    })

    it('includes breakdown in sycophancyScore', async () => {
      const breakdown = makeBreakdown()
      const result = await runScore(breakdown, [])

      expect(result.sycophancyScore.breakdown).toEqual(breakdown)
    })
  })

  // ---------------------------------------------------------------------------
  // Handler block execution: biasFormat
  // ---------------------------------------------------------------------------

  describe('biasFormat (execution)', () => {
    async function runFormat(
      score: number,
      biases: BiasAnnotation[],
      counterArguments: Array<{ claim: string; counterpoint: string; strength: number; sources?: string[] }> = [],
    ) {
      const block = biasFormat()
      const ctx = { response: { emit: async () => {} } } as any
      const breakdown = makeBreakdown()

      return block.run({
        userInput: 'test input',
        aiResponse: 'test response',
        biases,
        sycophancyScore: {
          overall: score,
          label: labelForSycophancyScore(score),
          breakdown,
        },
        counterArguments,
      } as any, ctx)
    }

    it('sets analyzerId and category', async () => {
      const result = await runFormat(0.1, [])
      expect(result.analyzerId).toBe('bias-sycophancy')
      expect(result.category).toBe('metacognition')
    })

    it('maps score to correct severity', async () => {
      const balanced = await runFormat(0.1, [])
      expect(balanced.severity).toBe('info')

      const moderate = await runFormat(0.5, [makeBias()])
      expect(moderate.severity).toBe('warning')

      const sycophantic = await runFormat(0.8, [makeBias()])
      expect(sycophantic.severity).toBe('critical')
    })

    it('includes all annotations in output', async () => {
      const biases = [
        makeBias({ biasType: 'sycophancy' }),
        makeBias({ biasType: 'confirmation_bias' }),
      ]
      const result = await runFormat(0.5, biases)
      expect(result.annotations).toHaveLength(2)
      expect(result.annotations[0].biasType).toBe('sycophancy')
      expect(result.annotations[1].biasType).toBe('confirmation_bias')
    })

    it('includes counter-arguments in output', async () => {
      const counters = [{
        claim: 'test claim',
        counterpoint: 'test counterpoint',
        strength: 0.7,
      }]
      const result = await runFormat(0.5, [makeBias()], counters)
      expect(result.counterArguments).toHaveLength(1)
      expect(result.counterArguments[0].claim).toBe('test claim')
    })

    it('includes sycophancyScore in output', async () => {
      const result = await runFormat(0.45, [])
      expect(result.sycophancyScore.overall).toBe(0.45)
      expect(result.sycophancyScore.label).toBe('moderate_bias')
    })

    it('generates a summary', async () => {
      const result = await runFormat(0.5, [makeBias({ biasType: 'sycophancy' })])
      expect(result.summary).toBeTruthy()
      expect(result.summary.length).toBeGreaterThan(0)
    })

    it('output validates against biasAnalyzerOutputSchema', async () => {
      const result = await runFormat(0.5, [makeBias()], [{
        claim: 'c',
        counterpoint: 'cp',
        strength: 0.6,
      }])
      expect(biasAnalyzerOutputSchema.safeParse(result).success).toBe(true)
    })
  })
})
