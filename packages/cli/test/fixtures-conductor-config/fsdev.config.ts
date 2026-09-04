/**
 * Config-path fixture for conductor: a FlowState wrapping the keyword-routed
 * conductor fixture so `getRuntime()` runs (and init narration can be tested).
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import conductor from "../fixtures-conductor/flows/conductor/flow";

export default createFlowState({
  flows: { conductor },
  stores: { default: { primary: inMemoryStores() } },
});
