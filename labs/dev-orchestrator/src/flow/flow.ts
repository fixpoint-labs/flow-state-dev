/**
 * The dev-orchestrator flow definition.
 *
 * For this slice the flow exposes a single durable action — the spec stage.
 * Implement and review stages slot in here later behind the same shape (the
 * stage machine already routes to them). The flow is built per babysit run with
 * its dependencies (the Linear client for the final write, the repo root and
 * `claude` resolver for dispatch) injected, so tests can supply fakes.
 */
import { defineFlow } from "@flow-state-dev/core";
import { buildSpecStage, specStageInputSchema, type SpecStageOptions } from "./stages/spec";

/** Dependencies the flow's stages close over. */
export type DevOrchestratorFlowOptions = SpecStageOptions;

/** Build a `dev-orchestrator` flow instance with injected dependencies. */
export function buildDevOrchestratorFlow(options: DevOrchestratorFlowOptions) {
  const specStage = buildSpecStage(options);

  return defineFlow({
    kind: "dev-orchestrator",
    actions: {
      spec: {
        block: specStage,
        inputSchema: specStageInputSchema,
      },
    },
  })();
}
