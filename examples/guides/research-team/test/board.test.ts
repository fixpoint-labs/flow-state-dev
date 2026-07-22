import { describe, it, expect } from "vitest";
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { testBlock } from "@flow-state-dev/testing";
import { researchCompany } from "../src/skill-boards";

type TaskChange = {
  type?: string;
  component?: string;
  data?: { task?: { id: string; status: string } };
};

// `researchCompany` is the drain-as-tool the migrated `research-company` skill
// exposes (FIX-918): a static market + financial + synthesizer board wrapped in
// a sequencer that seeds from `{ topic }`, drains, and projects the brief.
describe("researchCompany drain-as-tool", () => {
  it("runs both analysts, then the synthesizer, and returns the projected brief", async () => {
    const result = await testBlock(researchCompany, { input: { topic: "ACME Corp" } });
    expect(result.error).toBeNull();

    const statusByTask = new Map<string, string>();
    for (const item of result.items as TaskChange[]) {
      if (item.type !== "component" || item.component !== "task-change" || !item.data?.task) continue;
      statusByTask.set(item.data.task.id, item.data.task.status);
    }

    expect(statusByTask.get("market")).toBe("completed");
    expect(statusByTask.get("financial")).toBe("completed");
    expect(statusByTask.get("synth")).toBe("completed");

    // The tool returns the synthesizer's brief, stitched from both analysts'
    // findings (read off `input.deps`), not the raw board trace.
    const report = (result.output as { report: string }).report;
    expect(report).toContain("market: ACME Corp");
    expect(report).toContain("financial: ACME Corp");
  });

  it("a second call in the same request drains a fresh board, not colliding on task ids", async () => {
    // Two researchCompany calls in ONE request. With a fixed collection id +
    // fixed task ids (`market`/`financial`/`synth`) the second call's seed would
    // throw "task already exists"; per-call collection isolation (FIX-918 PR
    // review) gives each call its own fresh board.
    const twice = (
      sequencer({
        name: "research-twice",
        inputSchema: z.object({}),
        outputSchema: z.object({ report: z.string() }),
      }) as unknown as {
        step: (b: unknown) => { step: (b: unknown) => unknown };
      }
    )
      .step((researchCompany as unknown as { connectInput: (f: () => unknown) => unknown }).connectInput(() => ({ topic: "ACME Corp" })))
      .step((researchCompany as unknown as { connectInput: (f: () => unknown) => unknown }).connectInput(() => ({ topic: "Globex Inc" })));

    const result = await testBlock(twice as never, { input: {} as never });
    expect(result.error).toBeNull();
    // Output is the SECOND call's brief — proof it ran fresh, not a stale
    // first-call board or a duplicate-id error.
    const report = (result.output as { report: string }).report;
    expect(report).toContain("market: Globex Inc");
    expect(report).toContain("financial: Globex Inc");
  });
});
