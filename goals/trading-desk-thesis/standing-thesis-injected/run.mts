/**
 * Goal check — a standing thesis reaches the desk's decision tier (FIX-760).
 *
 * Three raw `fsdev run` steps from `labs/trading-desk` (config search is
 * cwd-only), all sharing one throwaway `TRADING_DESK_DATA_DIR` so they hit the
 * same PGlite backing and the same CLI principal:
 *   1. portfolio saveThesis  — write the thesis through the real action + repo.
 *   2. analysis analyze       — seedSession reads + freezes it; trader/PM see
 *                               <standingThesis>; the PM commit derives the echo.
 *   3. analysis runSummary    — zero-model read-back.
 * Then assert: completed, PM memo published, hasStandingThesis === true.
 * See goal.md for the contract.
 *
 * Run: pnpm tsx goals/trading-desk-thesis/standing-thesis-injected/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const STAMP = Date.now();
// Isolated, throwaway PGlite dir shared by all three steps (single-process,
// sequential — never concurrent), so the run never lands in real Past Reports.
const DATA_DIR = mkdtempSync(join(tmpdir(), "fsd-thesis-goal-"));
const CAPTURE_DIR = `${APP}/.fsdev/headless`;
const SUMMARY_CAPTURE = `${CAPTURE_DIR}/goal_thesis_${STAMP}.summary.json`;
const ANALYZE_SESSION = `goal_thesis_${STAMP}`;

mkdirSync(CAPTURE_DIR, { recursive: true });

function fsdev(flow: string, args: string[]): number {
  try {
    execFileSync("pnpm", ["fsdev", "run", flow, ...args], {
      stdio: "inherit",
      cwd: APP,
      env: { ...process.env, TRADING_DESK_DATA_DIR: DATA_DIR },
    });
    return 0;
  } catch (err) {
    return typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 1;
  }
}

// 1. Seed the standing thesis (same CLI principal as the analyze run below).
const saveExit = fsdev("portfolio", [
  "saveThesis",
  "-i",
  JSON.stringify({
    ticker: "NVDA",
    entryRationale:
      "Held for the data-center compute super-cycle; demand outruns supply through 2027.",
    invalidationConditions: "Hyperscaler capex guidance cut two quarters running.",
    timeHorizon: "years",
  }),
  "--session",
  `goal_seed_${STAMP}`,
]);

// 2. The real analyze run on the same ticker. Exit 0 = ran; non-zero = errored.
const analyzeExit = fsdev("analysis", [
  "analyze",
  "-i",
  '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}',
  "--session",
  ANALYZE_SESSION,
  "--capture",
  `${CAPTURE_DIR}/${ANALYZE_SESSION}.analyze.json`,
  "--quiet",
]);

// 3. The zero-model read-back.
const summaryExit = fsdev("analysis", [
  "runSummary",
  "-i",
  "{}",
  "--session",
  ANALYZE_SESSION,
  "--capture",
  SUMMARY_CAPTURE,
  "--quiet",
]);

const failures: string[] = [];
if (saveExit !== 0) failures.push(`saveThesis exited ${saveExit}`);
if (analyzeExit !== 0) failures.push(`analyze exited ${analyzeExit}`);
if (summaryExit !== 0) failures.push(`runSummary exited ${summaryExit}`);

if (failures.length === 0) {
  const capture = JSON.parse(readFileSync(SUMMARY_CAPTURE, "utf8")) as {
    result?: { output?: Record<string, unknown> };
  };
  const summary = capture.result?.output ?? {};

  if (summary.status !== "completed") {
    failures.push(
      `status ${String(summary.status)} (${String(summary.error ?? summary.stopReason ?? "")})`,
    );
  }
  const memos = Array.isArray(summary.memos)
    ? (summary.memos as Array<Record<string, unknown>>)
    : [];
  const pm = memos.find((m) => m.key === "p5/portfolio-manager");
  if (pm?.status !== "published") {
    failures.push(`PM memo not published (${String(pm?.status)})`);
  }
  // The load-bearing assertion: the standing thesis reached the decision tier.
  if (summary.hasStandingThesis !== true) {
    failures.push(`hasStandingThesis is ${String(summary.hasStandingThesis)} (expected true)`);
  }

  if (failures.length === 0) {
    console.log(
      `PASS — NVDA fixture/fast completed with a published PM memo and ` +
        `hasStandingThesis === true. Summary: ${SUMMARY_CAPTURE}`,
    );
    process.exit(0);
  }
}

console.error("FAIL —\n" + failures.join("\n"));
process.exit(1);
