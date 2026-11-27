/**
 * `cursorHarness()` hands the runner's `access` feed to the Cursor block
 * (FIX-2900), so a run the runner makes read-only is one. The block is
 * replaced by a recorder, so the options the harness hands it are what's read.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
vi.mock("../src/agent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cursorAgent: (options: Record<string, unknown>) => (seen.options.push(options), {}),
}));

const { cursorHarness } = await import("../src/harness");

describe("cursorHarness and the access feed", () => {
  it("hands the feed to the block, and hands none when the runner gives none", () => {
    const feeds = { cwd: () => "/work", worktree: () => "/work", resume: () => null, onSession: () => {}, onUsage: () => {} };
    const access = () => "read-only" as const;
    cursorHarness().agent({ ...feeds, access });
    cursorHarness().agent(feeds);
    expect(seen.options[0]!.access).toBe(access);
    expect("access" in seen.options[1]!).toBe(false);
  });
});
