// FIX-2411.
/**
 * One module, one component, and the row helpers a host drawing its own
 * session rows shares with it.
 *
 * The flow inventory, the grouping and the fenced leaf read are the
 * navigator's internals and stay unexported: three public hooks would let
 * three consumers each trigger their own flow-list read, which is the
 * one-read-per-host rule lost by export rather than by bug.
 */
export {
  FlowNavigator,
  type FlowNavigatorLeafState,
  type FlowNavigatorProps,
  type FlowNavigatorRow,
  type FlowNavigatorSlots
} from "./FlowNavigator";

export { sessionAge, sessionLabel, sessionRowState, type SessionRowState } from "./session-row";

export type {
  FlowCardinality,
  FlowNavigatorLeaf,
  FlowNavigatorSection
} from "./grouping";
