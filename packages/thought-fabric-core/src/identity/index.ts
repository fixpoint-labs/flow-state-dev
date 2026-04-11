// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, config factory
// ---------------------------------------------------------------------------

export {
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
} from './constitution.js'
export type {
  ConstitutionPrinciple,
  ConstitutionContextualOverride,
  ConstitutionConflictResolution,
  ConstitutionConfig,
  ConstitutionDefinition,
  ConstitutionPrincipleResult,
  ConstitutionViolation,
  ConstitutionTradeoff,
  ConstitutionReviewInput,
  ConstitutionReviewOutput,
} from './constitution.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
  DEFAULT_CONSTITUTION_CONFIG,
  rankConstitutionPrinciples,
  computeConstitutionCompliance,
  formatConstitution,
  summarizeConstitutionReview,
} from './constitution-helpers.js'
export type { ConstitutionHelperConfig } from './constitution-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories
// ---------------------------------------------------------------------------

export {
  constitutionReview,
  constitutionEnforce,
  constitutionAuditor,
} from './constitution-blocks.js'
export type {
  ConstitutionReviewBlockConfig,
  ConstitutionEnforceBlockConfig,
  ConstitutionAuditorBlockConfig,
} from './constitution-blocks.js'

// ---------------------------------------------------------------------------
// Perspective (placeholder — FIX-201)
// ---------------------------------------------------------------------------

export { perspective } from './perspective.js'
export type { PerspectiveConfig, PerspectiveInstance } from './perspective.js'
