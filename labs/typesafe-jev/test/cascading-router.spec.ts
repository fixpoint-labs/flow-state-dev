/**
 * cascadingRouter: trees stay in code. Evaluator stays atomic.
 * Missing / low confidence fail-closes to ambiguous.
 */
import { describe, expect, it } from "vitest";
import { testRouter } from "@flow-state-dev/testing";
import {
  createCascadingTriageRouter,
  reviewLeaf,
} from "../src/cascading-flow";
import { cascadeGateOpen } from "../src/cascading-router";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import type { StructuredAnswers } from "../src/system-2";
import { scriptedClient } from "./scripted-client";

const TICKET = {
  subject: "Duplicate charge",
  message: "My card was charged twice. Help ASAP.",
};

function choiceAnswer(
  choice: string,
  extras: { confidence?: number; probability?: number } = {},
): TypeSafeEvaluateOutput["answers"][string] {
  const probability = extras.probability ?? 0.91;
  return {
    type: "choice",
    choice,
    probabilities: { [choice]: probability },
    ...(extras.confidence !== undefined ? { confidence: extras.confidence } : {}),
  };
}

function departmentThenUrgency(opts: {
  department: string;
  departmentConfidence?: number;
  departmentProbability?: number;
  urgency?: string;
  urgencyConfidence?: number;
}) {
  return scriptedClient((request): TypeSafeEvaluateOutput => {
    if (request.questions.urgency !== undefined) {
      return {
        model: "typesafe-ai/jev",
        path: "evaluate",
        answers: {
          urgency: choiceAnswer(opts.urgency ?? "high", {
            confidence: opts.urgencyConfidence,
          }),
        },
      };
    }
    return {
      model: "typesafe-ai/jev",
      path: "evaluate",
      answers: {
        department: choiceAnswer(opts.department, {
          confidence: opts.departmentConfidence,
          probability: opts.departmentProbability,
        }),
      },
    };
  });
}

describe("cascadingRouter", () => {
  it("walks a two-level tree and runs the leaf block", async () => {
    const { client, calls } = departmentThenUrgency({
      department: "billing",
      departmentConfidence: 0.82,
      urgency: "high",
      urgencyConfidence: 0.77,
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });

    expect(result.error).toBeNull();
    expect(result.selectedRoute).toBe("escalate");
    expect(result.output).toEqual({ path: "escalate", echo: TICKET });
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[0]?.request.questions ?? {})).toEqual(["department"]);
    expect(Object.keys(calls[1]?.request.questions ?? {})).toEqual(["urgency"]);
  });

  it("takes the second-level low-urgency leaf", async () => {
    const { client } = departmentThenUrgency({
      department: "billing",
      departmentConfidence: 0.8,
      urgency: "low",
      urgencyConfidence: 0.7,
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });
    expect(result.selectedRoute).toBe("billing-queue");
  });

  it("lands on a first-level leaf without a second evaluate", async () => {
    const { client, calls } = departmentThenUrgency({
      department: "technical",
      departmentConfidence: 0.88,
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });
    expect(result.selectedRoute).toBe("tech-queue");
    expect(calls).toHaveLength(1);
  });

  it("takes ambiguous when first-level confidence is low", async () => {
    const { client, calls } = departmentThenUrgency({
      department: "billing",
      departmentConfidence: 0.2,
      urgency: "high",
      urgencyConfidence: 0.99,
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });
    expect(result.selectedRoute).toBe(reviewLeaf.name);
    expect(result.output).toMatchObject({ path: "review" });
    expect(calls).toHaveLength(1);
  });

  it("takes ambiguous when confidence is missing — never the high branch", async () => {
    const { client, calls } = departmentThenUrgency({
      department: "billing",
      departmentConfidence: 0.9,
      urgency: "high",
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });
    expect(result.selectedRoute).toBe("review");
    expect(calls).toHaveLength(2);
  });

  it("takes ambiguous when selected probability is below the floor", async () => {
    const { client } = departmentThenUrgency({
      department: "billing",
      departmentConfidence: 0.9,
      departmentProbability: 0.4,
    });
    const result = await testRouter(createCascadingTriageRouter({ client }), {
      input: TICKET,
    });
    expect(result.selectedRoute).toBe("review");
  });

  it("still compiles a tree on the System 2 path with synthetic confidence", async () => {
    const block = createCascadingTriageRouter({
      mode: "system-2",
      generate: async ({ prompt }): Promise<StructuredAnswers> => {
        if (prompt.includes("How urgent")) {
          return { urgency: { type: "choice", choice: "low" } };
        }
        return { department: { type: "choice", choice: "billing" } };
      },
    });
    const result = await testRouter(block, { input: TICKET });
    expect(result.error).toBeNull();
    expect(result.selectedRoute).toBe("billing-queue");
  });

  it("fail-closes a gate when confidence is absent", () => {
    expect(
      cascadeGateOpen(
        {
          model: "typesafe-ai/jev",
          path: "evaluate",
          answers: {
            department: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.9 },
            },
          },
        },
        "department",
        "billing",
        { minConfidence: 0.6 },
      ),
    ).toBe(false);
  });
});
