/**
 * FIX-1551 · POC fixture config. `fsdev run` loads this the way it loads an
 * app's `fsdev.config.ts`. The FlowState is stashed on `globalThis` so the test
 * can read the stores the CLI wrote through after the run disposes it.
 */
import { makeFlowState } from "./app";

const flowState = makeFlowState();
(globalThis as { __pocFlowState?: unknown }).__pocFlowState = flowState;

export default flowState;
