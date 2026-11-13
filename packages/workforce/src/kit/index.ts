/**
 * `@flow-state-dev/workforce/kit`: workforce as a kit, for
 * `createFlowState({ kits: [workforce({ … })] })`.
 *
 * Node-only: the kit's folder reader reads the app's `workforce/` folder at
 * start-up. Import it from the app's server entry.
 */
export {
  workforce,
  type GeneratedWorkforce,
  type WorkforceAgentOptions,
  type WorkforceConfig,
  type WorkforceCoordinatorOptions,
  type WorkforceFlowsBuilder,
} from "./workforce-kit";
