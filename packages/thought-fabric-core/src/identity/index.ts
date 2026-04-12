// ---------------------------------------------------------------------------
// Constitution (placeholder — implementation on separate branch)
// ---------------------------------------------------------------------------

export { constitution } from './constitution.js'
export type { ConstitutionConfig, ConstitutionInstance } from './constitution.js'

// ---------------------------------------------------------------------------
// Perspective — Layer 1: Schemas, types, factory
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
// Perspective — Layer 2: Helpers
// ---------------------------------------------------------------------------

export {
  formatPerspectiveSalience,
  formatPerspectiveReasoning,
  formatPerspective,
  summarizePerspective,
  perspectiveContextFormatter,
} from './perspective-helpers.js'

// ---------------------------------------------------------------------------
// Perspective — Layer 3: Block factories
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
