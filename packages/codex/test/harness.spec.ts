/**
 * `codexHarness()`: Codex as one value for the harness kit's `harnesses`
 * slot. Its agent is the Codex block built from the run's feeds, and a run
 * is handed only Codex's own environment.
 */
import { describe, expect, it } from "vitest";
import { codexHarness } from "../src/harness";

const feeds = {
  cwd: () => "/work",
  resume: () => null,
  onSession: () => undefined,
  onUsage: () => undefined,
};

describe("codexHarness", () => {
  it("is keyed `codex` and builds the Codex block a run runs", () => {
    const harness = codexHarness();
    expect(harness.id).toBe("codex");
    expect(harness.label).toBe("Codex");
    const block = harness.agent(feeds as never) as unknown as { config: { name: string } };
    expect(block.config.name).toBe("codex");
    expect(harness.pass).toContain("CODEX_API_KEY");
  });
});
