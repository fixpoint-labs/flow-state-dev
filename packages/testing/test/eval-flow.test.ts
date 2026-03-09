import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { evalFlow, exactMatch, contains } from "../src/eval";

const passthroughSchema = {
  safeParse: (input: unknown) => ({ success: true as const, data: input }),
};

function createTestFlowInstance(): FlowInstance {
  return {
    id: "eval-test",
    kind: "eval-test-flow",
    requireUser: true,
    actions: {
      echo: {
        inputSchema: passthroughSchema as any,
        block: handler<{ value: string }, { echoed: string }>({
          name: "echo-handler",
          execute: (input) => ({ echoed: input.value }),
        }),
      },
    },
  } as FlowInstance;
}

describe("evalFlow", () => {
  it("evaluates a dataset against a flow", async () => {
    const flow = createTestFlowInstance();
    const report = await evalFlow(flow, {
      action: "echo",
      dataset: [
        { id: "f1", input: { value: "hello" }, expected: { echoed: "hello" } },
        { id: "f2", input: { value: "world" }, expected: { echoed: "world" } },
      ],
      scorers: [exactMatch()],
      userId: "test-user",
    });

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].caseId).toBe("f1");
    expect(report.results[0].scores["exactMatch"]).toMatchObject({
      score: 1,
      passed: true,
    });
  });

  it("handles failing scorer", async () => {
    const flow = createTestFlowInstance();
    const report = await evalFlow(flow, {
      action: "echo",
      dataset: [
        { input: { value: "hello" }, expected: { echoed: "wrong" } },
      ],
      scorers: [exactMatch()],
    });

    expect(report.passed).toBe(false);
    expect(report.results[0].passed).toBe(false);
  });

  it("supports multiple scorers", async () => {
    const flow = createTestFlowInstance();
    const report = await evalFlow(flow, {
      action: "echo",
      dataset: [
        { input: { value: "hello" }, expected: { echoed: "hello" } },
      ],
      scorers: [exactMatch(), contains("hello")],
    });

    expect(report.passed).toBe(true);
    expect(Object.keys(report.results[0].scores)).toHaveLength(2);
  });

  it("uses default userId when not provided", async () => {
    const flow = createTestFlowInstance();
    const report = await evalFlow(flow, {
      action: "echo",
      dataset: [
        { input: { value: "test" }, expected: { echoed: "test" } },
      ],
      scorers: [exactMatch()],
    });

    expect(report.passed).toBe(true);
  });

  it("produces JSON-serializable report", async () => {
    const flow = createTestFlowInstance();
    const report = await evalFlow(flow, {
      action: "echo",
      dataset: [
        { input: { value: "test" }, expected: { echoed: "test" } },
      ],
      scorers: [exactMatch()],
    });

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.passed).toBe(true);
  });
});
