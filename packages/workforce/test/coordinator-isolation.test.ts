/**
 * The coordinator flow reads its judgment turn's `isolateUserState` as the
 * `agent` flow reads it: an app that composes memory into the turn and asks
 * for isolation gets its user-scoped storage keyed by the coordinator copy.
 * Without the forward the option was accepted and did nothing.
 */
import { describe, expect, it } from "vitest";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { hireWorkforce } from "../src/workers/register";
import { createWorkerInstallation } from "../src/workers/installation";

function coordinatorCopy(isolateUserState?: boolean) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "desk", declared: { flow: "coordinator", delegates: ["otto"] }, body: "" },
      { id: "otto", declared: { flow: "agent" }, body: "You answer questions." }
    ],
    workerFlows: () => flows as never
  });
  const agentFlow = defineAgentWorkerFlow({ installation });
  const coordinator = defineCoordinatorFlow({
    installation,
    delegateFlows: [agentFlow],
    routeModel: "typesafe-ai/jev",
    ...(isolateUserState === undefined ? {} : { agent: { isolateUserState } })
  });
  flows = { agent: agentFlow, coordinator };
  const copies = hireWorkforce(installation);
  return { coordinator: copies.find((copy) => copy.id === "coordinator")!, agent: copies.find((copy) => copy.id === "agent")! };
}

describe("the coordinator flow's isolateUserState", () => {
  it("is the judgment turn's, and leaves the agent copy shared", () => {
    const { coordinator, agent } = coordinatorCopy(true);
    expect(coordinator.isolateUserState).toBe(true);
    expect(agent.isolateUserState).toBe(false);
  });

  it("is off when the app doesn't ask", () => {
    expect(coordinatorCopy().coordinator.isolateUserState).toBe(false);
    expect(coordinatorCopy(false).coordinator.isolateUserState).toBe(false);
  });
});
