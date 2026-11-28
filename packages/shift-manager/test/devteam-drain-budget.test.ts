/**
 * Stopping the Lab waits for a coding run still going, checks and judge
 * included, instead of cancelling it at the engine's 30 s default.
 *
 * The run's own deadline plus the ten minutes the project's checks get is the
 * least the shutdown has to wait; the Lab hands `createFlowState` a
 * `dispatchDrainTimeoutMs` at least that long. With no run cap named, the
 * Lab passes none to the harness kit, and a shutdown still waits the
 * harness-manager's own run wait plus the checks.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { readyHarness } from "../teams/devteam/harness.mts";

/** The options the Lab built its FlowState with. */
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

const { inMemoryStores } = await import("@flow-state-dev/engine");
const { openLab } = await import("../teams/devteam/host.mts");
const RUN_TIMEOUT_MS = 20 * 60_000;
const PROJECT_CHECKS_MS = 10 * 60_000;
/** The harness-manager's shutdown wait for a run with no host-named cap (its `SHUTDOWN_RUN_WAIT_MS`). */
const SHUTDOWN_RUN_WAIT_MS = 20 * 60_000;

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe("stopping the Lab", () => {
  const open = async (runTimeoutMs?: number) => {
    const lab = await openLab({
      stores: inMemoryStores(),
      harnesses: [readyHarness(harnessStub().slot)],
      ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
      workspace: { root: mkdtempSync(join(tmpdir(), "sm-drain-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
    });
    dispose = () => lab.dispose();
  };

  it("waits long enough for a full coding run and its project checks", async () => {
    await open(RUN_TIMEOUT_MS);
    expect(built.harnesses?.runTimeoutMs).toBe(RUN_TIMEOUT_MS);
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS + PROJECT_CHECKS_MS);
  }, 60_000);

  it("names no run cap when none is set, so a busy run isn't stopped at a Lab wall clock", async () => {
    await open();
    expect(built.harnesses).toBeDefined();
    expect(Object.hasOwn(built.harnesses!, "runTimeoutMs")).toBe(false);
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(SHUTDOWN_RUN_WAIT_MS + PROJECT_CHECKS_MS);
  }, 60_000);
});
