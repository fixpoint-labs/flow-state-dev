/**
 * `@flow-state-dev/harness-manager/kit`: coding harnesses as a kit, and the
 * one coding worker flow it contributes to workforce.
 *
 * The only entry of this package that imports workforce.
 */
export { HARNESSES_FLOW, harnesses, type HarnessesConfig } from "./harnesses-kit";
export { CODER_FLOW, codingDrainBudgetMs, type CoderFlowOptions } from "./coder-flow";
