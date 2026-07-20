import { describe, it, expect } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { researchRouter } from "../src/research-router";

type TaskChange = {
  type?: string;
  component?: string;
  data?: { task?: { id: string; status: string } };
};

describe("runtime fan-out router", () => {
  it("builds one analyzer task per competitor plus a synthesizer, and drains them", async () => {
    const result = await testBlock(researchRouter, {
      input: { subject: "Linear", competitors: ["Jira", "Asana", "Trello"] },
    });
    expect(result.error).toBeNull();

    const completed = new Set<string>();
    for (const item of result.items as TaskChange[]) {
      if (item.type !== "component" || item.component !== "task-change" || !item.data?.task) continue;
      if (item.data.task.status === "completed") completed.add(item.data.task.id);
    }

    // three analyzers (one per competitor) + the synthesizer, all completed
    expect(completed.has("analyze-0")).toBe(true);
    expect(completed.has("analyze-1")).toBe(true);
    expect(completed.has("analyze-2")).toBe(true);
    expect(completed.has("synth")).toBe(true);
  });
});
