/**
 * Stopping the lab waits for a coding run still going, its checks included,
 * instead of cancelling it at the engine's 30 s default.
 *
 * The run's own deadline plus the ten minutes the working folder's checks get
 * is the least a shutdown has to wait; the lab hands `createFlowState` a
 * `dispatchDrainTimeoutMs` at least that long.
 *
 * With `TEAMMATES_RUN_TIMEOUT_MS` unset the lab names no run cap of its own:
 * a busy run must not be stopped at a lab-chosen wall clock, so the
 * harness-manager's idle window and default cap apply, and a shutdown still
 * waits the manager's own run wait plus the checks.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** The options the lab built its FlowState and harness kit with. */
const built: { options?: { dispatchDrainTimeoutMs?: number }; harnesses?: Record<string, unknown> } = {};
vi.mock("@flow-state-dev/harness-manager/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/harness-manager/kit")>();
  const harnesses = Object.assign((options: Parameters<typeof actual.harnesses>[0]) => {
    built.harnesses = options as unknown as Record<string, unknown>;
    return actual.harnesses(options);
  }, actual.harnesses);
  return { ...actual, harnesses };
});
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
/** The harness-manager's shutdown wait for a run with no host-named cap (its `SHUTDOWN_RUN_WAIT_MS`). */
const SHUTDOWN_RUN_WAIT_MS = 20 * 60_000;

async function open(runTimeoutMs?: number) {
  const dir = mkdtempSync(join(tmpdir(), "teammates-drain-"));
  const workdir = join(dir, "repo");
  execFileSync("git", ["init", "-q", workdir]);
  await openTeammates({
    store: join(dir, "teammates.sqlite"),
    model: "openai/gpt-6-luna",
    userId: "you",
    workdir,
    runsRoot: join(dir, "runs"),
    ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
    checks: ["pnpm test"],
  });
}

describe("stopping the lab", () => {
  it("waits long enough for a full coding run and its checks", async () => {
    await open(RUN_TIMEOUT_MS);
    expect(built.harnesses?.runTimeoutMs).toBe(RUN_TIMEOUT_MS);
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS + CHECKS_MS);
  }, 60_000);

  it("names no run cap when the setting is unset, so a busy run isn't stopped at a lab wall clock", async () => {
    await open();
    expect(built.harnesses).toBeDefined();
    expect(Object.hasOwn(built.harnesses!, "runTimeoutMs")).toBe(false);
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(SHUTDOWN_RUN_WAIT_MS + CHECKS_MS);
  }, 60_000);
});
