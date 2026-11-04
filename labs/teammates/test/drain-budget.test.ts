/**
 * Stopping the lab waits for a coding run still going, its checks included,
 * instead of cancelling it at the engine's 30 s default.
 *
 * The run's own deadline plus the ten minutes the working folder's checks get
 * is the least a shutdown has to wait; the lab hands `createFlowState` a
 * `dispatchDrainTimeoutMs` at least that long.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The options the lab built its FlowState with. */
const built: { options?: { dispatchDrainTimeoutMs?: number } } = {};
vi.mock("@flow-state-dev/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/engine")>();
  return {
    ...actual,
    createFlowState: (options: Parameters<typeof actual.createFlowState>[0]) => {
      built.options = options as { dispatchDrainTimeoutMs?: number };
      return actual.createFlowState(options);
    },
  };
});

const { openTeammates } = await import("../host.mts");

const RUN_TIMEOUT_MS = 20 * 60_000;
const CHECKS_MS = 10 * 60_000;

describe("stopping the lab", () => {
  it("waits long enough for a full coding run and its checks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "teammates-drain-"));
    const workdir = join(dir, "repo");
    execFileSync("git", ["init", "-q", workdir]);
    await openTeammates({
      store: join(dir, "teammates.sqlite"),
      model: "openai/gpt-6-luna",
      userId: "you",
      workdir,
      runsRoot: join(dir, "runs"),
      runTimeoutMs: RUN_TIMEOUT_MS,
      checks: ["pnpm test"],
    });
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS + CHECKS_MS);
  }, 60_000);
});
