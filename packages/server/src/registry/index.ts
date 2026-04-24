/**
 * Public registry API surface for flow registration and lookup.
 */
export {
  createFlowRegistry,
  InMemoryFlowRegistry,
  type FlowRegistry,
  type SharedSchemasDescription,
  type SharedScopeDescription
} from "./flow-registry";

export {
  CrossFlowSchemaConflictError,
  type ConflictScope,
  type CrossFlowSchemaConflictDetails
} from "./errors";
