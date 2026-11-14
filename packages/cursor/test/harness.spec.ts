/**
 * `cursorHarness()`: Cursor as one value for the harness kit's `harnesses`
 * slot. Its agent is the Cursor block built from the run's feeds, naming a
 * model, since a local Cursor run must.
 */
import { describe, expect, it } from "vitest";
import { cursorHarness } from "../src/harness";

const feeds = {
  cwd: () => "/work",
  resume: () => null,
  onSession: () => undefined,
  onUsage: () => undefined,
};

describe("cursorHarness", () => {
  it("is keyed `cursor` and builds the Cursor block a run runs", () => {
    const harness = cursorHarness();
    expect(harness.id).toBe("cursor");
    expect(harness.label).toBe("Cursor");
    const block = harness.agent(feeds as never) as unknown as { config: { name: string } };
    expect(block.config.name).toBe("cursor");
    expect(harness.pass).toContain("CURSOR_API_KEY");
  });
});
