/**
 * Stopping the Lab waits for a coding run still going, checks and judge
 * included, instead of cancelling it at the engine's 30 s default.
 *
 * The run's own deadline plus the ten minutes the project's checks get is the
 * least the shutdown has to wait; the Lab hands `createFlowState` a
 * `dispatchDrainTimeoutMs` at least that long.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessStub } from "@flow-state-dev/harness-manager";

/** The options the Lab built its FlowState with. */
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

const { inMemoryStores } = await import("@flow-state-dev/engine");
const { openLab } = await import("../teams/devteam/host.mts");
const { CLAUDE_CODE_RUN_TIMEOUT_MS } = await import("../teams/devteam/harness.mts");

const PROJECT_CHECKS_MS = 10 * 60_000;

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe("stopping the Lab", () => {
  it("waits long enough for a full coding run and its project checks", async () => {
    const lab = await openLab({
      stores: inMemoryStores(),
      harness: harnessStub().slot,
      runTimeoutMs: CLAUDE_CODE_RUN_TIMEOUT_MS,
      workspace: { root: mkdtempSync(join(tmpdir(), "sm-drain-")), remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
    });
    dispose = () => lab.dispose();
    expect(built.options?.dispatchDrainTimeoutMs).toBeGreaterThanOrEqual(CLAUDE_CODE_RUN_TIMEOUT_MS + PROJECT_CHECKS_MS);
  }, 60_000);
});
