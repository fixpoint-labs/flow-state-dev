import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import researchTeamFlow from "../src/flow";

// These tests never need a model or an API key: the `research` and
// `researchCompetitors` actions use deterministic handler workers.

type Item = {
  type?: string;
  component?: string;
  data?: { task?: { id: string; status: string } };
};

function completedTaskIds(items: Item[]): Set<string> {
  const done = new Set<string>();
  for (const item of items) {
    if (item.type !== "component" || item.component !== "task-change") continue;
    if (item.data?.task?.status === "completed") done.add(item.data.task.id);
  }
  return done;
}

describe("research-team flow", () => {
  it("runs the static board end-to-end via the `research` action", async () => {
    const result = await testFlow({
      flow: researchTeamFlow,
      action: "research",
      userId: "test-user",
      input: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const done = completedTaskIds(result.items as Item[]);
    expect(done.has("market")).toBe(true);
    expect(done.has("financial")).toBe(true);
    expect(done.has("synth")).toBe(true);
  });

  it("fans out one analyzer per competitor via the `researchCompetitors` action", async () => {
    const result = await testFlow({
      flow: researchTeamFlow,
      action: "researchCompetitors",
      userId: "test-user",
      input: { subject: "Linear", competitors: ["Jira", "Asana", "Trello"] },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const done = completedTaskIds(result.items as Item[]);
    // three analyzers (one per competitor) + the gated synthesizer
    expect(done.has("analyze-0")).toBe(true);
    expect(done.has("analyze-1")).toBe(true);
    expect(done.has("analyze-2")).toBe(true);
    expect(done.has("synth")).toBe(true);
  });
});
