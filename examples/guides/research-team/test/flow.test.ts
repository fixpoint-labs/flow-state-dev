import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import { readSkillsDirectory } from "@flow-state-dev/orchestration";
import researchTeamFlow from "../src/flow";

// These tests never need a model or an API key: the `research` and
// `researchCompetitors` actions use deterministic handler workers, and the
// skill test only parses the SKILL.md folders.

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

  it("bundles two valid pattern:task-board skills", async () => {
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/skills",
    );
    const { skills, errors } = await readSkillsDirectory(dir);

    expect(errors).toEqual([]);

    const byName = new Map(skills.map((s) => [s.name, s]));
    expect(byName.has("research-company")).toBe(true);
    expect(byName.has("competitor-analysis")).toBe(true);

    // Both are pattern skills bound to the task board...
    expect(byName.get("research-company")?.skillMd).toContain("pattern: task-board");
    expect(byName.get("competitor-analysis")?.skillMd).toContain("pattern: task-board");

    // ...and their prompt-ref reference files come along for the ride.
    const researchFiles = byName.get("research-company")?.files ?? [];
    expect(researchFiles.map((f) => f.path)).toContain("reference/market.md");
  });
});
