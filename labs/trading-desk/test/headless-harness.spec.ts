/**
 * Unit tests for `runOne`'s orchestration + error branches, with the `fsdev`
 * subprocess and the capture-file reads mocked. The happy path is exercised
 * end-to-end (real models) by the `goals/` check; these tests pin the branchy
 * error handling that the real run does not reach — an analyze failure, a
 * runSummary-read failure, and an invalid read-back — without spawning anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, readFileSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));
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

function throwWithStatus(status: number): never {
  throw Object.assign(new Error(`exit ${status}`), { status });
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  readFileSyncMock.mockReset();
  mkdirSyncMock.mockReset();
});

describe("runOne", () => {
  it("merges run-level fields onto a completed read-back", async () => {
    execFileSyncMock.mockReturnValue(undefined); // both invocations succeed
    readFileSyncMock.mockImplementation((file: string) => {
      if (String(file).endsWith(".analyze.json")) {
        return JSON.stringify({ result: { success: true, execution: { durationMs: 5000 } } });
      }
      return JSON.stringify({ result: { success: true, output: ACTION_OUTPUT } });
    });

    const summary = await runOne(INPUT, OPTS);

    expect(execFileSyncMock).toHaveBeenCalledTimes(2); // analyze + runSummary
    expect(summary.status).toBe("completed");
    expect(summary.finalRating).toBe("Buy");
    expect(summary.durationMs).toBe(5000); // merged from the analyze capture
    expect(summary.exitCode).toBe(0);
    expect(summary.capturePath).toMatch(/\.analyze\.json$/);
    // The harness's session id wins over the action's echoed value.
    expect(summary.sessionId).not.toBe("seeded-by-action");
  });

  it("records status error and skips runSummary when analyze fails", async () => {
    execFileSyncMock.mockImplementation(() => throwWithStatus(3));
    readFileSyncMock.mockImplementation(() => {
      throw new Error("no capture written");
    });

    const summary = await runOne(INPUT, OPTS);

    expect(execFileSyncMock).toHaveBeenCalledTimes(1); // runSummary never ran
    expect(summary.status).toBe("error");
    expect(summary.exitCode).toBe(3);
    expect(summary.error).toContain("analyze exited 3");
    expect(summary.finalRating).toBeNull();
  });

  it("records status error when the runSummary read fails", async () => {
    execFileSyncMock
      .mockReturnValueOnce(undefined) // analyze ok
      .mockImplementationOnce(() => throwWithStatus(1)); // runSummary fails
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
    execFileSyncMock.mockReturnValue(undefined);
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
