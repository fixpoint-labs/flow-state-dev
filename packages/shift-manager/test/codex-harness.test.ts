/**
 * Codex in Shift Manager's slot must be able to write: Codex's own default
 * sandbox is read-only, and a coder that can't edit never makes the commit the
 * phase waits for.
 */
import { describe, expect, it, vi } from "vitest";

const seen: unknown[] = [];
vi.mock("@flow-state-dev/codex", async (real) => ({
  ...(await real<typeof import("@flow-state-dev/codex")>()),
  codexAgent: (options: unknown) => {
    seen.push(options);
    return {};
  },
}));

const { codexHarness } = await import("../teams/devteam/harness.mts");

describe("the Codex coder", () => {
  it("runs in a workspace-write sandbox, so it can edit and commit", () => {
    codexHarness({ cwd: "/tmp/work" } as never);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cwd: "/tmp/work", thread: { sandboxMode: "workspace-write" } });
  });
});
