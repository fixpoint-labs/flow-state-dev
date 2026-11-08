/**
 * The live line at the end of a running task's feed says the most specific
 * thing the task is doing now. A person watching a long run needs to tell
 * "running the tests" from "on step 3 of 5" from "alive, nothing more to say":
 * a less specific source must never hide a more specific one.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { toolInFlight, workingStatus } from "../registry/components/working-status";

const tool = (id: string, name: string, args: Record<string, unknown>, status: "in_progress" | "completed") =>
  ({ id, type: "tool_output", status, blockName: name, output: null, toolCall: { callId: id, name, arguments: JSON.stringify(args), generatorBlock: "g" } }) as unknown as OutputItem;

const PLAN = [
  { title: "Read the adapter", status: "completed" },
  { title: "Fix the ordering", status: "completed" },
  { title: "Add regression test", status: "in_progress" },
  { title: "Run the checks", status: "pending" },
  { title: "Open the PR", status: null },
];

describe("toolInFlight", () => {
  it("is the newest call whose output hasn't arrived, not a finished one after it", () => {
    const items = [tool("a", "Bash", { command: "ls" }, "in_progress"), tool("b", "Read", { file_path: "a.ts" }, "completed")];
    expect(toolInFlight(items)).toEqual({ tool: "Bash", args: { command: "ls" } });
  });

  it("is undefined when every call has finished", () => {
    expect(toolInFlight([tool("a", "Bash", { command: "ls" }, "completed")])).toBeUndefined();
  });
});

describe("workingStatus", () => {
  it("names the command in flight over the plan step and the note", () => {
    expect(workingStatus({ inFlight: { tool: "shell", args: { command: "cd labs/teammates && pnpm test" } }, plan: PLAN, note: "Looking at it" })).toBe(
      "Running pnpm test",
    );
  });

  it("names a file edit in flight by its file", () => {
    expect(workingStatus({ inFlight: { tool: "Edit", args: { file_path: "src/adapter.ts" } } })).toBe("Edit src/adapter.ts");
  });

  it("falls back to the plan step in progress, counted in the plan, whatever the harness spells it", () => {
    expect(workingStatus({ plan: PLAN, note: "Looking at it" })).toBe("Step 3 of 5: Add regression test");
    expect(workingStatus({ plan: [{ title: "Only step", status: "IN_PROGRESS" }] })).toBe("Step 1 of 1: Only step");
  });

  it("falls back to the run's own note when no plan step is in progress", () => {
    expect(workingStatus({ plan: PLAN.map((row) => ({ ...row, status: "completed" })), note: "Reading the session log" })).toBe("Reading the session log");
  });

  it("says nothing when no source says anything, so the line keeps its plain label", () => {
    expect(workingStatus({})).toBeUndefined();
    expect(workingStatus({ plan: null, note: "  " })).toBeUndefined();
  });
});
