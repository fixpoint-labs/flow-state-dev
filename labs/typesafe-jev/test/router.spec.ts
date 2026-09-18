/**
 * systemOneRouter: Choice over described routes; default is the fallback.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testRouter } from "@flow-state-dev/testing";
import { z } from "zod";
import { TypeSafeError } from "../src/errors";
import {
  SYSTEM_ONE_ROUTE_QUESTION,
  systemOneRouter,
} from "../src/router";
import { scriptedClient } from "./scripted-client";

const inputSchema = z.object({ message: z.string() });
const outputSchema = z.object({
  path: z.string(),
  echo: inputSchema,
});

function stub(path: string) {
  return handler({
    name: path,
    inputSchema,
    outputSchema,
    execute: (input) => ({ path, echo: input }),
  });
}

const plan = stub("plan");
const review = stub("review");
const chat = stub("chat");

function routeResult(choice: string, confidence: number) {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      [SYSTEM_ONE_ROUTE_QUESTION]: {
        type: "choice" as const,
        choice,
        probabilities: { plan: choice === "plan" ? 0.9 : 0.05, review: choice === "review" ? 0.9 : 0.05 },
        confidence,
      },
    },
  };
}

function modeRouter(result: ReturnType<typeof routeResult>, minConfidence?: number) {
  const scripted = scriptedClient(result);
  const block = systemOneRouter({
    name: "route-mode",
    inputSchema,
    outputSchema,
    minConfidence,
    client: scripted.client,
    routes: {
      plan: {
        description: "user is asking to plan something or needs to plan some work",
        block: plan,
      },
      review: {
        description: "User needs to review work that was just performed",
        block: review,
      },
      default: chat,
    },
  });
  return { block, calls: scripted.calls };
}

describe("systemOneRouter", () => {
  it("returns a router, not a generator or handler", () => {
    const { block } = modeRouter(routeResult("plan", 0.9));
    expect(block.kind).toBe("router");
    expect(block.name).toBe("route-mode");
  });

  it("runs the chosen child with the original input", async () => {
    const { block, calls } = modeRouter(routeResult("plan", 0.9));
    const result = await testRouter(block, {
      input: { message: "let us plan the launch" },
    });

    expect(result.error).toBeNull();
    expect(result.selectedRoute).toBe("plan");
    expect(result.output).toEqual({
      path: "plan",
      echo: { message: "let us plan the launch" },
    });
    expect(calls[0]?.request.state).toEqual({ message: "let us plan the launch" });
    expect(calls[0]?.request.questions[SYSTEM_ONE_ROUTE_QUESTION]).toMatchObject({
      type: "choice",
      criteria: {
        plan: "user is asking to plan something or needs to plan some work",
        review: "User needs to review work that was just performed",
      },
    });
    expect(calls[0]?.request.questions[SYSTEM_ONE_ROUTE_QUESTION]).not.toEqual(
      expect.objectContaining({ criteria: expect.objectContaining({ default: expect.anything() }) }),
    );
    expect(
      Object.keys(
        (calls[0]?.request.questions[SYSTEM_ONE_ROUTE_QUESTION] as { criteria: object }).criteria,
      ),
    ).toEqual(["plan", "review"]);
  });

  it("takes default when confidence is below the floor", async () => {
    const { block } = modeRouter(routeResult("plan", 0.2), 0.5);
    const result = await testRouter(block, {
      input: { message: "hmm" },
    });

    expect(result.error).toBeNull();
    expect(result.selectedRoute).toBe("chat");
    expect(result.output).toEqual({ path: "chat", echo: { message: "hmm" } });
  });

  it("takes default when the choice is not a described route", async () => {
    const { block } = modeRouter(routeResult("other", 0.99));
    const result = await testRouter(block, {
      input: { message: "???" },
    });

    expect(result.selectedRoute).toBe("chat");
    expect(result.output).toMatchObject({ path: "chat" });
  });

  it("refuses a map with no described routes", () => {
    expect(() =>
      systemOneRouter({
        name: "empty",
        inputSchema,
        routes: { default: chat },
      }),
    ).toThrow(TypeSafeError);
  });

  it("refuses a non-default route that is a bare block", () => {
    expect(() =>
      systemOneRouter({
        name: "bare",
        inputSchema,
        routes: { plan, default: chat },
      }),
    ).toThrow(/description/);
  });
});
