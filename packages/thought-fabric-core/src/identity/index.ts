// ===========================================================================
// Constitution
// ===========================================================================

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
} from './constitution'
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
} from './constitution'

// ---------------------------------------------------------------------------
// Layer 2: Helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
  DEFAULT_CONSTITUTION_CONFIG,
  rankConstitutionPrinciples,
  computeConstitutionCompliance,
  formatConstitution,
  summarizeConstitutionReview,
} from './constitution-helpers'
export type { ConstitutionHelperConfig } from './constitution-helpers'

// ---------------------------------------------------------------------------
// Layer 3: Block factories
// ---------------------------------------------------------------------------

export {
  constitutionReview,
  constitutionEnforce,
  constitutionAuditor,
} from './constitution-blocks'
export type {
  ConstitutionReviewBlockConfig,
  ConstitutionEnforceBlockConfig,
  ConstitutionAuditorBlockConfig,
} from './constitution-blocks'

// ===========================================================================
// Perspective — Phase A: Static foundation
// ===========================================================================

// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, factory
// ---------------------------------------------------------------------------

export {
  perspectiveSalienceSchema,
  perspectiveReasoningSchema,
  perspectiveCommunicationSchema,
  perspectiveConfigSchema,
  perspectiveAnalysisSchema,
  perspectiveInputSchema,
  perspectiveApplyOutputSchema,
  perspective,
} from './perspective'
export type {
  PerspectiveSalience,
  PerspectiveReasoning,
  PerspectiveCommunication,
  PerspectiveConfig,
  PerspectiveInstance,
  PerspectiveAnalysis,
  PerspectiveInput,
  PerspectiveApplyOutput,
} from './perspective'

// ---------------------------------------------------------------------------
// Layer 2: Helpers
// ---------------------------------------------------------------------------

export {
  formatPerspectiveSalience,
  formatPerspectiveReasoning,
  formatPerspective,
  summarizePerspective,
  perspectiveContextFormatter,
} from './perspective-helpers'

// ---------------------------------------------------------------------------
// Layer 3: Block factories (static)
// ---------------------------------------------------------------------------

export {
  perspectiveApply,
  perspectiveAnalyze,
  perspectiveAuditor,
} from './perspective-blocks'
export type {
  PerspectiveBlockConfig,
  PerspectiveAnalyzeConfig,
} from './perspective-blocks'

// ===========================================================================
// Perspective — Phase B: Resource-backed state
// ===========================================================================

// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, resources
// ---------------------------------------------------------------------------

export {
  perspectiveObservationSchema,
  perspectiveObservationsStateSchema,
  perspectivePositionChallengeSchema,
  perspectivePositionSchema,
  perspectivePositionsStateSchema,
  perspectiveObserveInputSchema,
  perspectiveObserveOutputSchema,
  perspectivePositionInputSchema,
  perspectiveChallengeInputSchema,
  perspectiveSnapshotOutputSchema,
  perspectiveObservationsResource,
  perspectivePositionsResource,
} from './perspective'
export type {
  PerspectiveObservation,
  PerspectiveObservationsState,
  PerspectivePosition,
  PerspectivePositionChallenge,
  PerspectivePositionsState,
  PerspectiveObserveInput,
  PerspectiveObserveOutput,
  PerspectivePositionInput,
  PerspectiveChallengeInput,
  PerspectiveSnapshotOutput,
} from './perspective'

// ---------------------------------------------------------------------------
// Layer 2: Helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
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
} from './perspective-helpers'
export type {
  PerspectiveObservationsRef,
  PerspectivePositionsRef,
  AddPerspectiveObservationInput,
  AddPerspectivePositionInput,
} from './perspective-helpers'

// ---------------------------------------------------------------------------
// Layer 3: Stateful blocks
// ---------------------------------------------------------------------------

export {
  perspectiveObserve,
  perspectivePosition,
  perspectiveChallenge,
  perspectiveSnapshot,
  perspectiveAdvance,
} from './perspective-blocks'
export type {
  PerspectiveStatefulBlockConfig,
  PerspectivePositionBlockConfig,
  PositionScope,
} from './perspective-blocks'

// ---------------------------------------------------------------------------
// Capability + system factory
// ---------------------------------------------------------------------------

export {
  createPerspectiveCapability,
} from './perspective-capability'
export type {
  PerspectiveCapability,
  PerspectiveCapabilityConfig,
} from './perspective-capability'

export {
  system,
} from './perspective-system'
export type {
  PerspectiveSystem,
  PerspectiveSystemConfig,
  PerspectiveAccumulated,
} from './perspective-system'
