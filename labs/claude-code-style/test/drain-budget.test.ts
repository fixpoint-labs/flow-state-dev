/**
 * Stopping the lab waits for a coding run still going, checks and judge
 * included, instead of cancelling it at the engine's 30 s default.
 *
 * A run's own deadline plus the ten minutes the project's checks get is the
 * least a shutdown has to wait; the host hands `createFlowState` a
 * `dispatchDrainTimeoutMs` at least that long.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The options the host built its FlowState with. */
const built: { options?: { dispatchDrainTimeoutMs?: number } } = {};
vi.mock("@flow-state-dev/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/engine")>();
  return {
    ...actual,
    createFlowState: (options: { dispatchDrainTimeoutMs?: number }) => {
      built.options = options;
      // The host copies old marks from the stores at start: none here.
      return { getRuntime: async () => ({ stores: { user: { list: async () => [] } } }) };
    },
  };
});

const RUN_TIMEOUT_MS = 20 * 60_000;
const PROJECT_CHECKS_MS = 10 * 60_000;

describe("stopping the lab", () => {
  it("waits long enough for a full coding run and its project checks", async () => {
    vi.stubEnv("CLAUDE_CODE_STYLE_DATA", mkdtempSync(join(tmpdir(), "cc-style-drain-")));
    await import("../fsdev.config.mts");
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS + PROJECT_CHECKS_MS);
  }, 60_000);
});
