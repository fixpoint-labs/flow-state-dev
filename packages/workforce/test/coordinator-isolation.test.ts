/**
 * The coordinator flow reads its judgment turn's `isolateUserState` as the
 * `agent` flow reads it. Without the forward the option was accepted and did nothing.
 */
import { describe, expect, it } from "vitest";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { createWorkerInstallation } from "../src/workers/installation";

function flows(isolateUserState?: boolean) {
  const installation = createWorkerInstallation();
  const agentFlow = defineAgentWorkerFlow({ installation });
  const coordinatorFlow = defineCoordinatorFlow({
    installation,
    delegateFlows: [agentFlow],
    routeModel: "typesafe-ai/jev",
    ...(isolateUserState === undefined ? {} : { agent: { isolateUserState } }),
  });
  return { coordinator: coordinatorFlow({ id: "coordinator" }), agent: agentFlow({ id: "agent" }) };
}

describe("the coordinator flow's isolateUserState", () => {
  it("is the judgment turn's, and leaves the agent flow shared", () => {
    const { coordinator, agent } = flows(true);
    expect(coordinator.isolateUserState).toBe(true);
    expect(agent.isolateUserState).toBe(false);
  });

  it("is off when the app doesn't ask", () => {
    expect(flows().coordinator.isolateUserState).toBe(false);
    expect(flows(false).coordinator.isolateUserState).toBe(false);
  });
});
