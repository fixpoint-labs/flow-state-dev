import { describe, it, expect } from 'vitest'
import {
  severitySchema,
  analyzerAnnotationSchema,
  analyzerResultSchema,
  auditorInputSchema,
  auditVerdictSchema,
  auditReportSchema,
  DEFAULT_AUDIT_THRESHOLDS,
} from '../../src/metacognition/response-auditor.js'
import type {
  AnalyzerResult,
  AuditReport,
} from '../../src/metacognition/response-auditor.js'
import {
  worstSeverity,
  aggregateSeverity,
  aggregateScore,
  determineVerdict,
  summarizeAudit,
  buildAuditReport,
} from '../../src/metacognition/response-auditor-helpers.js'
import { handler } from '@flow-state-dev/core'
import {
  responseAuditor,
  auditAggregate,
} from '../../src/metacognition/response-auditor-blocks.js'

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeResult(overrides?: Partial<AnalyzerResult>): AnalyzerResult {
  return {
    analyzerId: 'test-analyzer',
    category: 'metacognition',
    severity: 'info',
    score: 0.1,
    label: 'clean',
    summary: 'No issues found.',
    annotations: [],
    ...overrides,
  }
}

function makeAnnotation(overrides?: Record<string, unknown>) {
  return {
    type: 'test-finding',
    content: 'A test finding was detected.',
    confidence: 0.8,
    evidence: 'Line 42 contains the issue.',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe('metacognition/responseAuditor', () => {
  describe('schemas', () => {
    it('severitySchema validates all levels', () => {
      for (const s of ['info', 'warning', 'critical']) {
        expect(severitySchema.safeParse(s).success).toBe(true)
      }
      expect(severitySchema.safeParse('error').success).toBe(false)
    })

    it('analyzerAnnotationSchema validates a well-formed annotation', () => {
      const result = analyzerAnnotationSchema.safeParse(makeAnnotation())
      expect(result.success).toBe(true)
    })

    it('analyzerAnnotationSchema requires confidence in [0, 1]', () => {
      expect(
        analyzerAnnotationSchema.safeParse(makeAnnotation({ confidence: -0.1 })).success,
      ).toBe(false)
      expect(
        analyzerAnnotationSchema.safeParse(makeAnnotation({ confidence: 1.1 })).success,
      ).toBe(false)
    })

    it('analyzerAnnotationSchema allows optional evidence', () => {
      const { evidence: _, ...noEvidence } = makeAnnotation()
      expect(analyzerAnnotationSchema.safeParse(noEvidence).success).toBe(true)
    })

    it('analyzerResultSchema validates a well-formed result', () => {
      const result = analyzerResultSchema.safeParse(makeResult({
        annotations: [makeAnnotation()],
        suggestions: ['Fix the issue.'],
        metadata: { extra: true },
      }))
      expect(result.success).toBe(true)
    })

    it('analyzerResultSchema requires score in [0, 1]', () => {
      expect(analyzerResultSchema.safeParse(makeResult({ score: -0.1 })).success).toBe(false)
      expect(analyzerResultSchema.safeParse(makeResult({ score: 1.5 })).success).toBe(false)
    })

    it('analyzerResultSchema allows optional suggestions and metadata', () => {
      const result = analyzerResultSchema.safeParse(makeResult())
      expect(result.success).toBe(true)
    })

    it('auditorInputSchema validates user input and AI response', () => {
      expect(
        auditorInputSchema.safeParse({ userInput: 'hello', aiResponse: 'world' }).success,
      ).toBe(true)
      expect(
        auditorInputSchema.safeParse({ userInput: 'hello' }).success,
      ).toBe(false)
    })

    it('auditVerdictSchema validates pass, review, fail', () => {
      for (const v of ['pass', 'review', 'fail']) {
        expect(auditVerdictSchema.safeParse(v).success).toBe(true)
      }
      expect(auditVerdictSchema.safeParse('warn').success).toBe(false)
    })

    it('auditReportSchema validates a well-formed report', () => {
      const report: AuditReport = {
        verdict: 'pass',
        severity: 'info',
        score: 0.1,
        summary: 'All clear.',
        results: [makeResult()],
        annotationCount: 0,
        suggestions: [],
      }
      expect(auditReportSchema.safeParse(report).success).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  describe('helpers', () => {
    describe('worstSeverity', () => {
      it('returns the more severe level', () => {
        expect(worstSeverity('info', 'warning')).toBe('warning')
        expect(worstSeverity('critical', 'info')).toBe('critical')
        expect(worstSeverity('warning', 'warning')).toBe('warning')
      })

      it('info is the least severe', () => {
        expect(worstSeverity('info', 'info')).toBe('info')
      })
    })

    describe('aggregateSeverity', () => {
      it('returns info for empty results', () => {
        expect(aggregateSeverity([])).toBe('info')
      })

      it('returns the worst severity across results', () => {
        expect(
          aggregateSeverity([
            makeResult({ severity: 'info' }),
            makeResult({ severity: 'critical' }),
            makeResult({ severity: 'warning' }),
          ]),
        ).toBe('critical')
      })

      it('returns info when all results are info', () => {
        expect(
          aggregateSeverity([
            makeResult({ severity: 'info' }),
            makeResult({ severity: 'info' }),
          ]),
        ).toBe('info')
      })
    })

    describe('aggregateScore', () => {
      it('returns 0 for empty results', () => {
        expect(aggregateScore([])).toBe(0)
      })

      it('returns the maximum score', () => {
        expect(
          aggregateScore([
            makeResult({ score: 0.2 }),
            makeResult({ score: 0.8 }),
            makeResult({ score: 0.5 }),
          ]),
        ).toBe(0.8)
      })

      it('handles single result', () => {
        expect(aggregateScore([makeResult({ score: 0.4 })])).toBe(0.4)
      })
    })

    describe('determineVerdict', () => {
      it('returns pass for low scores', () => {
        expect(determineVerdict(0.1)).toBe('pass')
        expect(determineVerdict(0.29)).toBe('pass')
      })

      it('returns review for mid-range scores', () => {
        expect(determineVerdict(0.3)).toBe('review')
        expect(determineVerdict(0.5)).toBe('review')
        expect(determineVerdict(0.69)).toBe('review')
      })

      it('returns fail for high scores', () => {
        expect(determineVerdict(0.7)).toBe('fail')
        expect(determineVerdict(1.0)).toBe('fail')
      })

      it('respects custom thresholds', () => {
        const thresholds = { reviewThreshold: 0.5, failThreshold: 0.9 }
        expect(determineVerdict(0.4, thresholds)).toBe('pass')
        expect(determineVerdict(0.6, thresholds)).toBe('review')
        expect(determineVerdict(0.95, thresholds)).toBe('fail')
      })
    })

    describe('summarizeAudit', () => {
      it('reports when no analyzers ran', () => {
        expect(summarizeAudit([], 'pass')).toContain('No analyzers')
      })

      it('includes analyzer names on pass', () => {
        const summary = summarizeAudit([makeResult({ analyzerId: 'bias' })], 'pass')
        expect(summary).toContain('passed')
        expect(summary).toContain('bias')
      })

      it('lists flagged analyzers on review', () => {
        const summary = summarizeAudit(
          [makeResult({ analyzerId: 'bias', severity: 'warning' })],
          'review',
        )
        expect(summary).toContain('review')
        expect(summary).toContain('bias')
      })

      it('lists critical analyzers on fail', () => {
        const summary = summarizeAudit(
          [makeResult({ analyzerId: 'safety', severity: 'critical' })],
          'fail',
        )
        expect(summary).toContain('failed')
        expect(summary).toContain('safety')
      })
    })

    describe('buildAuditReport', () => {
      it('builds a passing report from clean results', () => {
        const report = buildAuditReport([makeResult({ score: 0.1 })])
        expect(report.verdict).toBe('pass')
        expect(report.severity).toBe('info')
        expect(report.score).toBe(0.1)
        expect(report.annotationCount).toBe(0)
        expect(report.suggestions).toEqual([])
        expect(report.results).toHaveLength(1)
      })

      it('builds a failing report from critical results', () => {
        const report = buildAuditReport([
          makeResult({
            score: 0.8,
            severity: 'critical',
            annotations: [makeAnnotation()],
            suggestions: ['Fix it.'],
          }),
        ])
        expect(report.verdict).toBe('fail')
        expect(report.severity).toBe('critical')
        expect(report.score).toBe(0.8)
        expect(report.annotationCount).toBe(1)
        expect(report.suggestions).toEqual(['Fix it.'])
      })

      it('aggregates annotations and suggestions from multiple analyzers', () => {
        const report = buildAuditReport([
          makeResult({
            analyzerId: 'a',
            score: 0.4,
            severity: 'warning',
            annotations: [makeAnnotation(), makeAnnotation()],
            suggestions: ['Fix A.'],
          }),
          makeResult({
            analyzerId: 'b',
            score: 0.5,
            severity: 'warning',
            annotations: [makeAnnotation()],
            suggestions: ['Fix B.'],
          }),
        ])
        expect(report.annotationCount).toBe(3)
        expect(report.suggestions).toEqual(['Fix A.', 'Fix B.'])
        expect(report.score).toBe(0.5)
        expect(report.verdict).toBe('review')
      })

      it('returns a clean report for empty results', () => {
        const report = buildAuditReport([])
        expect(report.verdict).toBe('pass')
        expect(report.severity).toBe('info')
        expect(report.score).toBe(0)
        expect(report.results).toHaveLength(0)
      })

      it('respects custom thresholds', () => {
        const report = buildAuditReport(
          [makeResult({ score: 0.5 })],
          { reviewThreshold: 0.6, failThreshold: 0.9 },
        )
        expect(report.verdict).toBe('pass')
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Block definitions
  // ---------------------------------------------------------------------------

  describe('blocks', () => {
    it('auditAggregate is a handler with correct name', () => {
      const block = auditAggregate()
      expect(block.kind).toBe('handler')
      expect(block.name).toBe('responseAuditor/aggregate')
    })

    it('auditAggregate accepts custom name', () => {
      const block = auditAggregate({ name: 'custom/aggregate' })
      expect(block.name).toBe('custom/aggregate')
    })

    it('auditAggregate handler execution produces an AuditReport', async () => {
      const block = auditAggregate()
      const ctx = { response: { emit: async () => {} } } as any
      const input = {
        'bias-sycophancy': makeResult({
          analyzerId: 'bias-sycophancy',
          score: 0.6,
          severity: 'warning',
          annotations: [makeAnnotation()],
        }),
      }
      const result = await block.run(input, ctx) as AuditReport
      expect(result.verdict).toBe('review')
      expect(result.severity).toBe('warning')
      expect(result.score).toBe(0.6)
      expect(result.annotationCount).toBe(1)
      expect(result.results).toHaveLength(1)
    })

    it('responseAuditor is a sequencer', () => {
      const mockAnalyzer = handler({
        name: 'mock-analyzer',
        outputSchema: analyzerResultSchema,
        execute: () => makeResult(),
      })
      const block = responseAuditor({
        analyzers: { 'test': mockAnalyzer as any },
      })
      expect(block.kind).toBe('sequencer')
      expect(block.name).toBe('responseAuditor')
    })

    it('responseAuditor accepts custom name', () => {
      const mockAnalyzer = handler({
        name: 'mock-analyzer',
        outputSchema: analyzerResultSchema,
        execute: () => makeResult(),
      })
      const block = responseAuditor({
        name: 'myAuditor',
        analyzers: { 'test': mockAnalyzer as any },
      })
      expect(block.name).toBe('myAuditor')
    })
  })

  // ---------------------------------------------------------------------------
  // Default thresholds
  // ---------------------------------------------------------------------------

  describe('defaults', () => {
    it('DEFAULT_AUDIT_THRESHOLDS has expected values', () => {
      expect(DEFAULT_AUDIT_THRESHOLDS.reviewThreshold).toBe(0.3)
      expect(DEFAULT_AUDIT_THRESHOLDS.failThreshold).toBe(0.7)
    })

    it('reviewThreshold < failThreshold', () => {
      expect(DEFAULT_AUDIT_THRESHOLDS.reviewThreshold).toBeLessThan(
        DEFAULT_AUDIT_THRESHOLDS.failThreshold,
      )
    })
  })
})
