/**
 * Unit tests for `runOne`'s orchestration + error branches, with the `fsdev`
 * subprocess (`spawn`) and the capture-file reads mocked. The happy path is
 * exercised end-to-end (real models) by the `goals/` check; these tests pin the
 * branchy error handling that the real run does not reach — an analyze failure,
 * a runSummary-read failure, and an invalid read-back — without spawning
 * anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, readFileSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({
  mkdirSync: mkdirSyncMock,
  readFileSync: readFileSyncMock,
}));

const { runOne } = await import("../scripts/headless/harness");
const { analyzeInputSchema } = await import("../src/flows/analysis/flow-schema");
const { runSummaryStateSchema } = await import("../src/flows/analysis/run-summary");

const INPUT = analyzeInputSchema.parse({
  ticker: "NVDA",
  dataSource: "fixture",
  costPreset: "fast",
});
const OPTS = { captureDir: "/tmp/headless-test", cwd: "/app" };

/** A schema-valid completed RunSummary, as the read action would return it. */
const ACTION_OUTPUT = runSummaryStateSchema.parse({
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast",
  dataSource: "fixture",
  sessionId: "seeded-by-action",
  status: "completed",
  finalRating: "Buy",
  ranAt: "2026-06-25T00:00:00.000Z",
  memos: [{ key: "p5/portfolio-manager", agentName: "portfolioManager", status: "published" }],
  memoErrors: 0,
});

/** A fake child process whose async `close` fires with the given exit code.
 *  `stdout`/`stderr` are no-op pipeable streams (the harness forwards them). */
function childExiting(code: number) {
  const stream = { pipe() {} };
  return {
    stdout: stream,
    stderr: stream,
    on(event: string, cb: (arg: unknown) => void) {
      if (event === "close") setTimeout(() => cb(code), 0);
      return this;
    },
  };
}

beforeEach(() => {
  spawnMock.mockReset();
  readFileSyncMock.mockReset();
  mkdirSyncMock.mockReset();
});

describe("runOne", () => {
  it("merges run-level fields onto a completed read-back", async () => {
    spawnMock.mockReturnValue(childExiting(0)); // both invocations succeed
    readFileSyncMock.mockImplementation((file: string) => {
      if (String(file).endsWith(".analyze.json")) {
        return JSON.stringify({ result: { success: true, execution: { durationMs: 5000 } } });
      }
      return JSON.stringify({ result: { success: true, output: ACTION_OUTPUT } });
    });

    const summary = await runOne(INPUT, OPTS);

    expect(spawnMock).toHaveBeenCalledTimes(2); // analyze + runSummary
    expect(summary.status).toBe("completed");
    expect(summary.finalRating).toBe("Buy");
    expect(summary.durationMs).toBe(5000); // merged from the analyze capture
    expect(summary.exitCode).toBe(0);
    expect(summary.capturePath).toMatch(/\.analyze\.json$/);
    // The harness's session id wins over the action's echoed value.
    expect(summary.sessionId).not.toBe("seeded-by-action");
  });

  it("records status error and skips runSummary when analyze fails", async () => {
    spawnMock.mockReturnValue(childExiting(3));
    readFileSyncMock.mockImplementation(() => {
      throw new Error("no capture written");
    });

    const summary = await runOne(INPUT, OPTS);

    expect(spawnMock).toHaveBeenCalledTimes(1); // runSummary never ran
    expect(summary.status).toBe("error");
    expect(summary.exitCode).toBe(3);
    expect(summary.error).toContain("analyze exited 3");
    expect(summary.finalRating).toBeNull();
  });

  it("records status error when the runSummary read fails", async () => {
    spawnMock
      .mockReturnValueOnce(childExiting(0)) // analyze ok
      .mockReturnValueOnce(childExiting(1)); // runSummary fails
    readFileSyncMock.mockImplementation((file: string) => {
      if (String(file).endsWith(".analyze.json")) {
        return JSON.stringify({ result: { success: true, execution: { durationMs: 4200 } } });
      }
      throw new Error("no summary capture");
    });

    const summary = await runOne(INPUT, OPTS);

    expect(summary.status).toBe("error");
    expect(summary.error).toContain("runSummary read failed");
    expect(summary.durationMs).toBe(4200); // still recovered from the analyze capture
  });

  it("records status error when the read-back output fails validation", async () => {
    spawnMock.mockReturnValue(childExiting(0));
    readFileSyncMock.mockImplementation((file: string) => {
      if (String(file).endsWith(".analyze.json")) {
        return JSON.stringify({ result: { success: true, execution: { durationMs: 1000 } } });
      }
      return JSON.stringify({ result: { success: true, output: { bogus: true } } });
    });

    const summary = await runOne(INPUT, OPTS);

    expect(summary.status).toBe("error");
    expect(summary.error).toContain("failed validation");
  });
});
