// FIX-2794.
/**
 * The harness manager stops a run once its harness has sent nothing for the
 * silence window, and it hears the harness only through the `onEvent` feed.
 * A Lab wrapper that copies the feeds by name and drops that one gets every
 * busy Codex or Cursor run stopped at the window, however much it is doing.
 */
import { describe, expect, it, vi } from "vitest";

const seen: { codex: unknown[]; cursor: unknown[] } = { codex: [], cursor: [] };
vi.mock("@flow-state-dev/codex", async (real) => ({
  ...(await real<typeof import("@flow-state-dev/codex")>()),
  codexAgent: (options: unknown) => {
    seen.codex.push(options);
    return {};
  },
}));
vi.mock("@flow-state-dev/cursor", async (real) => ({
  ...(await real<typeof import("@flow-state-dev/cursor")>()),
  cursorAgent: (options: unknown) => {
    seen.cursor.push(options);
    return {};
  },
}));

const { codexHarness, cursorHarness } = await import("../teams/devteam/harness.mts");

describe("the Lab's harness wrappers hand the run's events on", () => {
  const onEvent = () => undefined;

  it("Codex gets the manager's onEvent feed", () => {
    codexHarness({ cwd: "/tmp/work", onEvent } as never);
    expect(seen.codex.at(-1)).toMatchObject({ onEvent });
  });

  it("Cursor gets the manager's onEvent feed", () => {
    cursorHarness({ cwd: "/tmp/work", onEvent } as never);
    expect(seen.cursor.at(-1)).toMatchObject({ onEvent });
  });
});
