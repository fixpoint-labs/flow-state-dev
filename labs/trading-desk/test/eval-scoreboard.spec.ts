/**
 * Tests for the JSONL quality scoreboard (`eval/scoreboard.ts`, FIX-790).
 *
 * Intent encoded: a record round-trips through `qualityRecordSchema`; appends
 * are one self-contained line each; and a reader skips a TORN line (a killed
 * process's partial write) rather than throwing, so the corpus survives.
 */
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendScoreboardLine,
  assembleQualityRecord,
  buildErrorRecord,
  detailSidecarPath,
  readScoreboard,
} from "../eval/scoreboard";
import { qualityRecordSchema, type InvariantReport } from "../eval/types";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "eval-scoreboard-"));
}

const invariants: InvariantReport = {
  hard: { passed: 8, failed: 1 },
  soft: { passed: 2, flagged: 1 },
  skipped: 3,
  checks: [
    { id: "rating-envelope/final-within-band", severity: "hard", status: "fail", detail: "outside band" },
    { id: "scenario/count", severity: "hard", status: "pass", detail: "3 scenarios" },
    { id: "citations/phase2-integrity", severity: "soft", status: "flag", detail: "1 invalid tag" },
  ],
};

function bundle(sessionId: string): RunArtifactsBundle {
  return {
    summary: {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast",
      dataSource: "fixture",
      mandateId: "balanced",
      sessionId,
      status: "completed",
      stopReason: null,
      stopMessage: null,
      durationMs: null,
      exitCode: null,
      error: null,
      capturePath: null,
      ranAt: "2026-06-25T00:00:00.000Z",
      finalRating: "Overweight",
      decisionConfidence: 0.7,
      targetWeightPct: 3,
      direction: "long",
      sizePct: 4,
      stopPrice: 100,
      targetPrice: 150,
      holdingPeriod: "quarters",
      decidedAt: "2026-06-25T00:00:00.000Z",
      mandateVerdict: "clears",
      capacityVetoed: false,
      rewardToRiskLossAdjustedGlr: 2,
      worstCaseReturnPct: -10,
      hasStandingThesis: null,
      mandatePresent: null,
      policyVerdict: null,
      positionCapClamped: null,
      excluded: null,
      preGatePolicyTargetPct: null,
      memos: [],
      memoErrors: 0,
    },
    valuationSpine: null,
    rewardToRisk: null,
    lensConvergence: null,
    decisionSnapshot: null,
    riskMandate: null,
    citationIntegrity: null,
    hasUserThesis: false,
    p2Contributions: null,
    memos: [],
  };
}

function record(sessionId: string) {
  const evaluatedAt = "2026-07-12T10:00:00.000Z";
  return assembleQualityRecord({
    bundle: bundle(sessionId),
    invariants,
    judges: null,
    evaluatedAt,
    ranAt: "2026-06-25T00:00:00.000Z",
    detailPath: detailSidecarPath("/out", sessionId, evaluatedAt),
  });
}

const dirs: string[] = [];
afterEach(() => {
  dirs.length = 0;
});

describe("assembleQualityRecord", () => {
  it("produces a record that round-trips through qualityRecordSchema", () => {
    const rec = record("run_a");
    expect(() => qualityRecordSchema.parse(rec)).not.toThrow();
    // The hard failure is inlined on the scoreboard line for grep-ability.
    expect(rec.invariants.hardFailed).toBe(1);
    expect(rec.invariants.failures).toEqual([
      { id: "rating-envelope/final-within-band", detail: "outside band" },
    ]);
    // No judges → judges/judgeModel null.
    expect(rec.judges).toBeNull();
    expect(rec.judgeModel).toBeNull();
    // ranAt is the analyze time, not the read/eval time.
    expect(rec.ranAt).toBe("2026-06-25T00:00:00.000Z");
    expect(rec.evaluatedAt).toBe("2026-07-12T10:00:00.000Z");
  });

  it("builds a null-identity error record for a failed read", () => {
    const rec = buildErrorRecord({
      sessionId: "run_err",
      evaluatedAt: "2026-07-12T10:00:00.000Z",
      detail: "unreadable capture",
      detailPath: "/out/details/run_err.json",
    });
    expect(() => qualityRecordSchema.parse(rec)).not.toThrow();
    expect(rec.runStatus).toBe("error");
    expect(rec.ticker).toBeNull();
    expect(rec.warnings).toContain("unreadable capture");
  });
});

describe("append + read", () => {
  it("appends exactly one line per record and reads them all back", () => {
    const dir = tmp();
    const path = join(dir, "scoreboard.jsonl");
    appendScoreboardLine(path, record("run_a"));
    appendScoreboardLine(path, record("run_b"));

    const raw = readFileSync(path, "utf8");
    expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(2);

    const records = readScoreboard(path);
    expect(records.map((r) => r.sessionId)).toEqual(["run_a", "run_b"]);
  });

  it("skips a torn line rather than throwing", () => {
    const dir = tmp();
    const path = join(dir, "scoreboard.jsonl");
    appendScoreboardLine(path, record("run_a"));
    appendFileSync(path, '{"evalVersion":1,"sessionId":"tor', "utf8"); // torn write, no newline
    appendScoreboardLine(path, record("run_b"));

    const records = readScoreboard(path);
    expect(records.map((r) => r.sessionId)).toEqual(["run_a", "run_b"]);
  });

  it("returns an empty list for a missing scoreboard", () => {
    expect(readScoreboard(join(tmp(), "nope.jsonl"))).toEqual([]);
  });
});
