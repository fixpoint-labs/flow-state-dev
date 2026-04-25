// ---------------------------------------------------------------------------
// Constitution (placeholder — implementation on separate branch)
// ---------------------------------------------------------------------------

export { constitution } from './constitution.js'
export type { ConstitutionConfig, ConstitutionInstance } from './constitution.js'

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
} from './perspective.js'
export type {
  PerspectiveSalience,
  PerspectiveReasoning,
  PerspectiveCommunication,
  PerspectiveConfig,
  PerspectiveInstance,
  PerspectiveAnalysis,
  PerspectiveInput,
  PerspectiveApplyOutput,
} from './perspective.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers
// ---------------------------------------------------------------------------

export {
  formatPerspectiveSalience,
  formatPerspectiveReasoning,
  formatPerspective,
  summarizePerspective,
  perspectiveContextFormatter,
} from './perspective-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories (static)
// ---------------------------------------------------------------------------

export {
  perspectiveApply,
  perspectiveAnalyze,
  perspectiveAuditor,
} from './perspective-blocks.js'
export type {
  PerspectiveBlockConfig,
  PerspectiveAnalyzeConfig,
} from './perspective-blocks.js'

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
} from './perspective.js'
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
} from './perspective.js'

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
} from './perspective-helpers.js'
export type {
  PerspectiveObservationsRef,
  PerspectivePositionsRef,
  AddPerspectiveObservationInput,
  AddPerspectivePositionInput,
} from './perspective-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Stateful blocks
// ---------------------------------------------------------------------------

export {
  perspectiveObserve,
  perspectivePosition,
  perspectiveChallenge,
  perspectiveSnapshot,
  perspectiveAdvance,
} from './perspective-blocks.js'
export type {
  PerspectiveStatefulBlockConfig,
  PerspectivePositionBlockConfig,
  PositionScope,
} from './perspective-blocks.js'

// ---------------------------------------------------------------------------
// Capability + system factory
// ---------------------------------------------------------------------------

export {
  createPerspectiveCapability,
} from './perspective-capability.js'
export type {
  PerspectiveCapability,
  PerspectiveCapabilityConfig,
} from './perspective-capability.js'

export {
  system,
} from './perspective-system.js'
export type {
  PerspectiveSystem,
  PerspectiveSystemConfig,
  PerspectiveAccumulated,
} from './perspective-system.js'
