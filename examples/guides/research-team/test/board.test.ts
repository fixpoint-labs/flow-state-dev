/**
 * The code-first board, end-to-end and deterministic. `researchBoard.drain` is
 * a plain block: two analyst handlers run in parallel, then a synthesizer gated
 * on both stitches their findings off `input.deps`. No model, no API key — this
 * is the no-model path (the LLM skill surface is exercised by the `chat` action,
 * not here).
 */
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
    const result = await testBlock(researchBoard.drain, { input: undefined });
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
