import { describe, it, expect } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { researchBoard } from "../src/board";

type TaskChange = {
  type?: string;
  component?: string;
  data?: {
    kind?: string;
    task?: { id: string; status: string; output?: { report?: string } };
  };
};

describe("static research board", () => {
  it("runs both analysts, then the synthesizer, and passes deps through", async () => {
    const result = await testBlock(researchBoard.block, { input: undefined });
    expect(result.error).toBeNull();

    const statusByTask = new Map<string, string>();
    let synthReport: string | undefined;
    for (const item of result.items as TaskChange[]) {
      if (item.type !== "component" || item.component !== "task-change" || !item.data?.task) continue;
      statusByTask.set(item.data.task.id, item.data.task.status);
      if (item.data.kind === "completed" && item.data.task.id === "synth") {
        synthReport = item.data.task.output?.report;
      }
    }

    expect(statusByTask.get("market")).toBe("completed");
    expect(statusByTask.get("financial")).toBe("completed");
    expect(statusByTask.get("synth")).toBe("completed");
    // The synthesizer stitched both analysts' findings, read off input.deps.
    expect(synthReport).toContain("market: ACME Corp");
    expect(synthReport).toContain("financial: ACME Corp");
  });
});
