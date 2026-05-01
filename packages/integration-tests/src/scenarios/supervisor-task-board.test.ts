/**
 * S1 — supervisor + task-board regression scenario (the headline test).
 *
 * Drives the supervisor pattern through three concurrent worker tasks
 * with per-task review approvals and a final synthesis. The recent
 * regression manifested as an infinite loop in the task-board claim
 * system; this scenario completes deterministically when the dispatcher
 * + claim-system contract holds and either throws (sequencer loop guard)
 * or hits the vitest timeout when broken.
 *
 * Workers are mocked with predicate matching so each task's goal text
 * routes to its own deterministic output. The reviewer is a single
 * always-approve predicate, since a correct supervisor pipeline calls
 * the reviewer once per task and always wants the same verdict here.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import supervisorFlow from "./fixtures/supervisor-flow";
import { findBlockOutputs, inputContains, itemsByType } from "../helpers/assertions";

describe("supervisor + task-board regression", () => {
  it("runs three concurrent tasks through plan → workers → review → synthesize", async () => {
    const result = await testFlow({
      flow: supervisorFlow,
      action: "run",
      userId: "test-user",
      input: { goal: "Research X, Y, and Z then summarize" },
      generators: {
        "test-supervisor-planner": mockGenerator({
          name: "test-supervisor-planner",
          script: [
            {
              structuredOutput: {
                tasks: [
                  { id: "t1", goal: "Research X" },
                  { id: "t2", goal: "Research Y" },
                  { id: "t3", goal: "Research Z" }
                ]
              }
            }
          ]
        }),
        "test-worker": mockGenerator({
          name: "test-worker",
          script: [
            { when: inputContains("Research X"), then: { text: "X is foo" } },
            { when: inputContains("Research Y"), then: { text: "Y is bar" } },
            { when: inputContains("Research Z"), then: { text: "Z is baz" } }
          ]
        }),
        "test-supervisor-reviewer": mockGenerator({
          name: "test-supervisor-reviewer",
          script: [
            // One predicate covers every reviewer call across the three
            // concurrent workers — uniform "approve" verdict.
            { when: () => true, then: { structuredOutput: { decision: "approve" } } }
          ]
        }),
        "test-supervisor-synthesizer": mockGenerator({
          name: "test-supervisor-synthesizer",
          script: [{ text: "Combined: X is foo, Y is bar, Z is baz" }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    // Primary regression signal: the run completed cleanly. An infinite
    // loop in the dispatcher would either trip `DEFAULT_MAX_LOOP_GUARD`
    // (throws → result.error populated) or hit the vitest timeout.
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(itemsByType(result.items, "error")).toHaveLength(0);

    // All three workers ran exactly once.
    const workerOutputs = findBlockOutputs(result.items, "test-worker");
    expect(workerOutputs).toHaveLength(3);

    // Reviewer was invoked (one approval per worker output).
    const reviewerOutputs = findBlockOutputs(result.items, "test-supervisor-reviewer");
    expect(reviewerOutputs.length).toBeGreaterThanOrEqual(3);

    // Synthesizer ran once and produced the integrated output.
    const synthesizerOutputs = findBlockOutputs(result.items, "test-supervisor-synthesizer");
    expect(synthesizerOutputs).toHaveLength(1);

    // The pipeline's terminal is the synthesizer, so result.output is its text.
    expect(typeof result.output).toBe("string");
    const finalText = result.output as string;
    expect(finalText).toContain("X is foo");
    expect(finalText).toContain("Y is bar");
    expect(finalText).toContain("Z is baz");
  });
});
