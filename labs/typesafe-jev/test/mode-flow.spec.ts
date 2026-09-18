/**
 * Demo flow: systemOneRouter is the `route` action.
 */
import { describe, expect, it } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import {
  createSystemOneDemoFlow,
  SYSTEM_ONE_FLOW_KIND,
} from "../src/mode-flow";
import { SYSTEM_ONE_ROUTE_QUESTION } from "../src/router";
import { BILLING_RESULT, scriptedClient } from "./scripted-client";

const USER = "lab-user";

function routeResult(choice: string, confidence: number) {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      [SYSTEM_ONE_ROUTE_QUESTION]: {
        type: "choice" as const,
        choice,
        probabilities: { plan: 0.9, review: 0.1 },
        confidence,
      },
    },
  };
}

describe("system-one demo flow", () => {
  it("declares route and evaluate on the system-one kind", () => {
    const { client } = scriptedClient(routeResult("plan", 0.9));
    const flow = createSystemOneDemoFlow({ client });
    expect(flow.kind).toBe(SYSTEM_ONE_FLOW_KIND);
    expect(Object.keys(flow.actions).sort()).toEqual(["evaluate", "route"]);
  });

  it("route runs the plan stub when Jev picks plan with high confidence", async () => {
    const { client, calls } = scriptedClient(routeResult("plan", 0.92));
    const result = await testFlow({
      flow: createSystemOneDemoFlow({ client }),
      action: "route",
      userId: USER,
      input: { message: "let us plan the launch" },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      path: "plan",
      echo: { message: "let us plan the launch" },
    });
    expect(
      Object.keys(
        (calls[0]?.request.questions[SYSTEM_ONE_ROUTE_QUESTION] as { criteria: object })
          .criteria,
      ),
    ).toEqual(["plan", "review"]);
  });

  it("route falls through to chat when confidence is low", async () => {
    const { client } = scriptedClient(routeResult("review", 0.11));
    const result = await testFlow({
      flow: createSystemOneDemoFlow({ client, minConfidence: 0.5 }),
      action: "route",
      userId: USER,
      input: { message: "not sure" },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({
      path: "chat",
      echo: { message: "not sure" },
    });
  });

  it("evaluate still exposes the low-level primitive", async () => {
    const { client } = scriptedClient(BILLING_RESULT);
    const result = await testFlow({
      flow: createSystemOneDemoFlow({ client }),
      action: "evaluate",
      userId: USER,
      input: {
        state: "Help ASAP",
        questions: { urgent: { type: "noul", instructions: "Urgent?" } },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual(BILLING_RESULT);
  });
});
