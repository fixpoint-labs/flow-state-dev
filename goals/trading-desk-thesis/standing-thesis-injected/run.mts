/**
 * Goal check — a standing thesis reaches the desk's decision tier (FIX-760).
 *
 * Three raw `fsdev run` steps from `labs/trading-desk` (config search is
 * cwd-only), all sharing one throwaway `TRADING_DESK_DATA_DIR` so they hit the
 * same PGlite backing and the same CLI principal:
 *   1. portfolio saveThesis  — write the thesis through the real action into the
 *                               user-scoped `theses` resource collection.
 *   2. analysis analyze       — seedSession reads + freezes it; trader/PM see
 *                               <standingThesis>; the PM commit derives the echo.
 *   3. analysis runSummary    — zero-model read-back.
 * Then assert: completed, PM memo published, hasStandingThesis === true.
 * See goal.md for the contract.
 *
 * Run: pnpm tsx goals/trading-desk-thesis/standing-thesis-injected/run.mts
 */
import { join } from "node:path";
import {
  TRADING_DESK,
  goalSessionId,
  goalTmpDir,
  readCapture,
  runFsdev,
  runGoal,
} from "../../lib/index.mts";

const SCRATCH = goalTmpDir("desk-thesis");
// Isolated, throwaway PGlite dir shared by all three steps (single-process,
// sequential — never concurrent), so the run never lands in real Past Reports.
const DATA_DIR = join(SCRATCH, "data");
const SUMMARY_CAPTURE = join(SCRATCH, "summary.json");
const ANALYZE_SESSION = goalSessionId("thesis");
const SEED_SESSION = goalSessionId("thesis-seed");

const deskEnv = { TRADING_DESK_DATA_DIR: DATA_DIR };

await runGoal(() => {
  // 1. Seed the standing thesis (same CLI principal as the analyze run below).
  const saveExit = runFsdev({
    app: TRADING_DESK,
    flow: "portfolio",
    action: "saveThesis",
    input: {
      ticker: "NVDA",
      entryRationale:
        "Held for the data-center compute super-cycle; demand outruns supply through 2027.",
      invalidationConditions: "Hyperscaler capex guidance cut two quarters running.",
      timeHorizon: "years",
    },
    session: SEED_SESSION,
    env: deskEnv,
  });

  // 2. The real analyze run on the same ticker. Exit 0 = ran; non-zero = errored.
  const analyzeExit = runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "analyze",
    input: { ticker: "NVDA", dataSource: "fixture", costPreset: "fast" },
    session: ANALYZE_SESSION,
    capture: join(SCRATCH, "analyze.json"),
    quiet: true,
    env: deskEnv,
  });

  // 3. The zero-model read-back.
  const summaryExit = runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "runSummary",
    session: ANALYZE_SESSION,
    capture: SUMMARY_CAPTURE,
    quiet: true,
    env: deskEnv,
  });

  const failures: string[] = [];
  if (saveExit !== 0) failures.push(`saveThesis exited ${saveExit}`);
  if (analyzeExit !== 0) failures.push(`analyze exited ${analyzeExit}`);
  if (summaryExit !== 0) failures.push(`runSummary exited ${summaryExit}`);
  if (failures.length > 0) return { failures, evidence: "" };

  const summary = (readCapture(SUMMARY_CAPTURE).result.output ?? {}) as Record<string, unknown>;

  if (summary.status !== "completed") {
    failures.push(
      `status ${String(summary.status)} (${String(summary.error ?? summary.stopReason ?? "")})`,
    );
  }
  const memos = Array.isArray(summary.memos)
    ? (summary.memos as Array<Record<string, unknown>>)
    : [];
  const pm = memos.find((m) => m.key === "p5/portfolio-manager");
  if (pm?.status !== "published") failures.push(`PM memo not published (${String(pm?.status)})`);

  // The load-bearing assertion: the standing thesis reached the decision tier.
  if (summary.hasStandingThesis !== true) {
    failures.push(`hasStandingThesis is ${String(summary.hasStandingThesis)} (expected true)`);
  }

  return {
    failures,
    evidence:
      "NVDA fixture/fast completed with a published PM memo and hasStandingThesis === true. " +
      `Summary: ${SUMMARY_CAPTURE}`,
  };
});
