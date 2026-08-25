// ---------------------------------------------------------------------------
// @flow-state-dev/conductor — lab barrel (LAB-138).
//
// The harness manager: a board row becomes a watched, settled coding run. One
// epic's board, one detached manager, a checkout that belongs to the run, and a
// verdict read before the row is settled.
//
// LAB-139 inherits this board — which is why its lifetime (durable, `user`-
// scoped, partitioned by epic) is settled here rather than at that altitude.
// ---------------------------------------------------------------------------

export {
  conductorFlow,
  CONDUCTOR_FLOW_KIND,
  ASSIGNEE,
  type ConductorFlowOptions,
} from "./flow";
export {
  harnessManager,
  conductorTaskInputSchema,
  releaseAllLeases,
  ConductorAttemptFailed,
  type ManagerOptions,
  type PhaseSpec,
  type PhaseRunContext,
} from "./manager";
export { implementPhase, type ImplementPhaseOptions } from "./implement";
export {
  RUNS,
  runRecordCollection,
  runRecordStateSchema,
  runOutcomeSchema,
  runTopic,
  runTopicPrefix,
  openRunRow,
  writeRunRow,
  readRunRow,
  type RunRecordState,
  type RunOutcome,
  type AttemptIdentity,
  type RunRowWrite,
} from "./run-record";
export {
  checkoutPathFor,
  branchFor,
  provisionCheckout,
  acquireCheckout,
  type WorkspaceConfig,
  type Checkout,
  type CheckoutLease,
  type OwnershipBounds,
} from "./workspace";
