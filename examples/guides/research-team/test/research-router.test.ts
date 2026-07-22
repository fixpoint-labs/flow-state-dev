import { describe, it, expect } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { analyzeCompetitors } from "../src/skill-boards";

type TaskChange = {
  type?: string;
  component?: string;
  data?: { task?: { id: string; status: string } };
};

// `analyzeCompetitors` is the drain-as-tool the migrated `competitor-analysis`
// skill exposes (FIX-918): one analyzer per named competitor fans out in
// parallel, a synthesizer gates on all of them, and the tool projects the read.
describe("analyzeCompetitors drain-as-tool", () => {
  it("fans out one analyzer per competitor plus a gated synthesizer, then projects the read", async () => {
    const result = await testBlock(analyzeCompetitors, {
      input: { topic: "Linear", competitors: ["Jira", "Asana", "Trello"] },
    });
    expect(result.error).toBeNull();

    const completed = new Set<string>();
    for (const item of result.items as TaskChange[]) {
      if (item.type !== "component" || item.component !== "task-change" || !item.data?.task) continue;
      if (item.data.task.status === "completed") completed.add(item.data.task.id);
    }

    // three analyzers (one per competitor) + the gated synthesizer, all completed
    expect(completed.has("analyze-0")).toBe(true);
    expect(completed.has("analyze-1")).toBe(true);
    expect(completed.has("analyze-2")).toBe(true);
    expect(completed.has("synth")).toBe(true);

    const report = (result.output as { report: string }).report;
    expect(report).toContain("Linear");
  });
});
