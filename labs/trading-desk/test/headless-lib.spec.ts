/**
 * Unit tests for the pure headless-harness helpers: manifest expansion, the
 * run-status → exit-code mapping, and the error-summary fallback.
 */
import { describe, expect, it } from "vitest";
import {
  errorSummary,
  exitCodeForStatus,
  expandManifest,
  type Manifest,
} from "../scripts/headless/lib";

describe("expandManifest", () => {
  it("uses an explicit runs list, filling schema defaults", () => {
    const manifest: Manifest = {
      scoreboard: "out.jsonl",
      runs: [{ ticker: "NVDA" }, { ticker: "AAPL", costPreset: "full" }],
    };
    const inputs = expandManifest(manifest);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].ticker).toBe("NVDA");
    expect(inputs[0].dataSource).toBe("fixture"); // schema default
    expect(inputs[0].costPreset).toBe("fast"); // schema default
    expect(inputs[1].costPreset).toBe("full");
  });

  it("expands a tickers × axes matrix by cartesian product", () => {
    const manifest: Manifest = {
      scoreboard: "out.jsonl",
      tickers: ["NVDA", "AAPL", "JPM"],
      axes: { date: ["2026-05-06"], costPreset: ["fast"], dataSource: ["fixture"] },
    };
    const inputs = expandManifest(manifest);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.ticker)).toEqual(["NVDA", "AAPL", "JPM"]);
    expect(inputs.every((i) => i.costPreset === "fast")).toBe(true);

    const wide = expandManifest({
      scoreboard: "out.jsonl",
      tickers: ["NVDA", "AAPL"],
      axes: { costPreset: ["fast", "full"] },
    });
    expect(wide).toHaveLength(4); // 2 tickers × 2 presets
  });

  it("expands the riskMandate axis, including a null (mandate-blind) entry", () => {
    const inputs = expandManifest({
      scoreboard: "out.jsonl",
      tickers: ["NVDA"],
      axes: { riskMandate: ["balanced", null] },
    });
    expect(inputs).toHaveLength(2); // 1 ticker × 2 mandates
    expect(inputs.map((i) => i.riskMandate)).toEqual(["balanced", null]);
  });

  it("defaults absent axes to the schema defaults", () => {
    const inputs = expandManifest({ scoreboard: "out.jsonl", tickers: ["NVDA"] });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast",
      dataSource: "fixture",
    });
  });

  it("returns [] when there is nothing to expand", () => {
    expect(expandManifest({ scoreboard: "out.jsonl" })).toEqual([]);
    expect(expandManifest({ scoreboard: "out.jsonl", tickers: [] })).toEqual([]);
  });
});

describe("exitCodeForStatus", () => {
  it("maps completed → 0, stopped → 2, error → 1", () => {
    expect(exitCodeForStatus("completed")).toBe(0);
    expect(exitCodeForStatus("stopped")).toBe(2);
    expect(exitCodeForStatus("error")).toBe(1);
  });
});

describe("errorSummary", () => {
  it("carries the input identity and the failure context, status error", () => {
    const summary = errorSummary({
      input: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "fast",
        dataSource: "fixture",
        userThesis: null,
        userThesisRationale: null,
        selectedAccountIds: [],
        riskMandate: "balanced",
      },
      sessionId: "run_x",
      ranAt: "2026-06-25T00:00:00.000Z",
      exitCode: 1,
      error: "analyze exited 1",
      durationMs: 1234,
      capturePath: "/tmp/x.analyze.json",
    });
    expect(summary.status).toBe("error");
    expect(summary.ticker).toBe("NVDA");
    expect(summary.mandateId).toBe("balanced");
    expect(summary.exitCode).toBe(1);
    expect(summary.error).toBe("analyze exited 1");
    expect(summary.durationMs).toBe(1234);
    expect(summary.finalRating).toBeNull();
    expect(summary.memos).toEqual([]);
  });
});
