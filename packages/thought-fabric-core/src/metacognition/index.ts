// ---------------------------------------------------------------------------
// Layer 1: Schemas, types — Response Auditor (canonical)
// ---------------------------------------------------------------------------

export {
  severitySchema,
  analyzerAnnotationSchema,
  analyzerResultSchema,
  auditorInputSchema,
  auditVerdictSchema,
  auditReportSchema,
  DEFAULT_AUDIT_THRESHOLDS,
} from './response-auditor.js'
export type {
  Severity,
  AnalyzerAnnotation,
  AnalyzerResult,
  AuditorInput,
  AuditVerdict,
  AuditReport,
  AnalyzerEntry,
  AuditThresholds,
} from './response-auditor.js'

// ---------------------------------------------------------------------------
// Layer 1: Schemas, types — Bias detection
// ---------------------------------------------------------------------------

export {
  biasTypeSchema,
  biasAnnotationSchema,
  counterArgumentSchema,
  sycophancyLabelSchema,
  sycophancyBreakdownSchema,
  sycophancyScoreSchema,
  biasAnalyzerInputSchema,
  biasAnalyzerOutputSchema,
  // Intermediate schemas (for custom pipeline composition)
  agreementDetectionOutputSchema,
  biasClassificationOutputSchema,
  biasScoringOutputSchema,
  counterpointOutputSchema,
} from './bias-detection.js'
export type {
  BiasType,
  BiasAnnotation,
  CounterArgument,
  SycophancyLabel,
  SycophancyBreakdown,
  SycophancyScore,
  BiasAnalyzerInput,
  BiasAnalyzerOutput,
  AgreementDetectionOutput,
  BiasClassificationOutput,
  BiasScoringOutput,
  CounterpointOutput,
} from './bias-detection.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers — Response Auditor
// ---------------------------------------------------------------------------

export {
  worstSeverity,
  aggregateSeverity,
  aggregateScore,
  determineVerdict,
  summarizeAudit,
  buildAuditReport,
} from './response-auditor-helpers.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers — Bias detection (verb-first naming)
// ---------------------------------------------------------------------------

export {
  DEFAULT_BIAS_ANALYZER_CONFIG,
  labelForSycophancyScore,
  severityForSycophancyScore,
  computeCompositeSycophancyScore,
  shouldGenerateCounterpoints,
  summarizeBiasFindings,
} from './bias-detection-helpers.js'
export type { BiasAnalyzerConfig } from './bias-detection-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories — Response Auditor
// ---------------------------------------------------------------------------

export {
  responseAuditor,
  auditAggregate,
} from './response-auditor-blocks.js'
export type { ResponseAuditorConfig } from './response-auditor-blocks.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories — Bias detection
// ---------------------------------------------------------------------------

export {
  biasDetectAgreement,
  biasClassify,
  biasScore,
  biasCounterpoint,
  biasFormat,
  biasAnalyzer,
} from './bias-detection-blocks.js'
export type { BiasAnalyzerBlockConfig } from './bias-detection-blocks.js'
