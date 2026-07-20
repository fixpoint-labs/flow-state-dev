import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import boardLifecycleFlow from "../src/lifecycle-flow";

// Deterministic workers — no model, no API key.

type ReadOutput = {
  tasks: Array<{ id: string; status: string; result: string | null }>;
};

// testFlow returns the root block's output as `output`; the read block is the
// last step, so its `{ tasks }` shape is what surfaces.
function tasksOf(result: { output?: unknown }): ReadOutput["tasks"] {
  return (result.output as ReadOutput).tasks;
}

describe("board lifecycle", () => {
  it("seedAndInspect: a seeded collection holds tasks, but with no drain they stay pending", async () => {
    const result = await testFlow({
      flow: boardLifecycleFlow,
      action: "seedAndInspect",
      userId: "u",
      input: { items: ["a", "b", "c"] },
    });

    expect(result.error).toBeUndefined();
    const tasks = tasksOf(result);
    expect(tasks).toHaveLength(3);
    // No board.drain ran, so nothing processed them.
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
    expect(tasks.every((t) => t.result === null)).toBe(true);
  });

  it("seedDrainRead: adding the board.drain drain moves the same tasks to completed", async () => {
    const result = await testFlow({
      flow: boardLifecycleFlow,
      action: "seedDrainRead",
      userId: "u",
      input: { items: ["a", "b", "c"] },
    });

    expect(result.error).toBeUndefined();
    const tasks = tasksOf(result);
    expect(tasks).toHaveLength(3);
    // The drain ran, so every task completed and carries its worker output.
    expect(tasks.every((t) => t.status === "completed")).toBe(true);
    expect(tasks.map((t) => t.result).sort()).toEqual(["A", "B", "C"]);
  });
});
