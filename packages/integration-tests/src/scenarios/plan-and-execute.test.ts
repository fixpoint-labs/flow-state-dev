/**
 * S6 — plan-and-execute pattern.
 *
 * Drives the pattern from `@flow-state-dev/patterns/plan-and-execute`
 * through a minimal flow. Mocks the planner (returns three tasks), the
 * executor (one predicate per task goal), and the synthesizer (combines
 * results). Verifies all three executor invocations land in the items
 * stream and the final synthesized text is produced.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import planAndExecuteFlow from "./fixtures/plan-and-execute-flow";
import { findBlockOutputs, findMessage, inputContains, messageText } from "../helpers/assertions";

describe("plan-and-execute", () => {
  it("runs all tasks and aggregates results into the synthesizer output", async () => {
    const result = await testFlow({
      flow: planAndExecuteFlow,
      action: "run",
      userId: "test-user",
      input: { goal: "Three things" },
      generators: {
        "pae-test-planner": mockGenerator({
          name: "pae-test-planner",
          script: [
            {
              structuredOutput: {
                tasks: [
                  { id: "a", goal: "Thing A" },
                  { id: "b", goal: "Thing B" },
                  { id: "c", goal: "Thing C" }
                ]
              }
            }
          ]
        }),
        "pae-test-executor": mockGenerator({
          name: "pae-test-executor",
          script: [
            {
              when: inputContains("Thing A"),
              then: {
                structuredOutput: {
                  summary: "Did A",
                  success: true,
                  reason: "",
                  sources: []
                }
              }
            },
            {
              when: inputContains("Thing B"),
              then: {
                structuredOutput: {
                  summary: "Did B",
                  success: true,
                  reason: "",
                  sources: []
                }
              }
            },
            {
              when: inputContains("Thing C"),
              then: {
                structuredOutput: {
                  summary: "Did C",
                  success: true,
                  reason: "",
                  sources: []
                }
              }
            }
          ]
        }),
        "pae-test-synthesizer": mockGenerator({
          name: "pae-test-synthesizer",
          script: [{ text: "Did A, B, and C." }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const executorOutputs = findBlockOutputs(result.items, "pae-test-executor");
    expect(executorOutputs).toHaveLength(3);

    const assistant = findMessage(result.items, "assistant");
    expect(assistant).toBeDefined();
    expect(messageText(assistant!)).toBe("Did A, B, and C.");
  });
});
