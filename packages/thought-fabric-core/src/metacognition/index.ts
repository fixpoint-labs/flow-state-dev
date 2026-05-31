// ---------------------------------------------------------------------------
// Layer 1: Schemas, types
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
  analyzerResultSchema,
  // Intermediate schemas (for custom pipeline composition)
  agreementDetectionOutputSchema,
  biasClassificationOutputSchema,
  biasScoringOutputSchema,
  counterpointOutputSchema,
} from './bias-detection'
export type {
  BiasType,
  BiasAnnotation,
  CounterArgument,
  SycophancyLabel,
  SycophancyBreakdown,
  SycophancyScore,
  BiasAnalyzerInput,
  BiasAnalyzerOutput,
  AnalyzerResult,
  AgreementDetectionOutput,
  BiasClassificationOutput,
  BiasScoringOutput,
  CounterpointOutput,
} from './bias-detection'

// ---------------------------------------------------------------------------
// Layer 2: Helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
  DEFAULT_BIAS_ANALYZER_CONFIG,
  labelForSycophancyScore,
  severityForSycophancyScore,
  computeCompositeSycophancyScore,
  shouldGenerateCounterpoints,
  summarizeBiasFindings,
} from './bias-detection-helpers'
export type { BiasAnalyzerConfig } from './bias-detection-helpers'

// ---------------------------------------------------------------------------
// Layer 3: Block factories
// ---------------------------------------------------------------------------

export {
  biasDetectAgreement,
  biasClassify,
  biasScore,
  biasCounterpoint,
  biasFormat,
  biasAnalyzer,
} from './bias-detection-blocks'
export type { BiasAnalyzerBlockConfig } from './bias-detection-blocks'
