/**
 * Goal check — a trading-desk headless run is clean and machine-readable.
 *
 * Drives the real path the `verify-trading-desk` skill teaches: raw `fsdev run`
 * for `analyze` then the zero-model `runSummary`, both `--capture --quiet`, from
 * `labs/trading-desk` (config search is cwd-only). Real models via the desk's
 * intent ladder + Vercel AI Gateway; fixture mode stubs DATA tools only, so the
 * generators run live. Then asserts the summary capture: completed, a non-null
 * rating, PM memo published. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/trading-desk-headless/fixture-run-clean/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SESSION = `goal_nvda_${Date.now()}`;
const CAPTURE_DIR = `${APP}/.fsdev/headless`;
const ANALYZE_CAPTURE = `${CAPTURE_DIR}/${SESSION}.analyze.json`;
const SUMMARY_CAPTURE = `${CAPTURE_DIR}/${SESSION}.summary.json`;

mkdirSync(CAPTURE_DIR, { recursive: true });

function fsdev(args: string[]): number {
  try {
    execFileSync("pnpm", ["fsdev", "run", "analysis", ...args], {
      stdio: "inherit",
      cwd: APP,
    });
    return 0;
  } catch (err) {
    // execFileSync throws on a non-zero exit; surface the code (errored run).
    return typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 1;
  }
}

// 1. The real run. Exit 0 = ran (completed OR stopped); non-zero = errored.
const analyzeExit = fsdev([
  "analyze",
  "-i",
  '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}',
  "--session",
  SESSION,
  "--capture",
  ANALYZE_CAPTURE,
  "--quiet",
]);

// 2. The zero-model read-back — the machine-readable RunSummary.
const summaryExit = fsdev([
  "runSummary",
  "-i",
  "{}",
  "--session",
  SESSION,
  "--capture",
  SUMMARY_CAPTURE,
  "--quiet",
]);

const failures: string[] = [];
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
  if (summary.finalRating == null) {
    failures.push("completed but finalRating is null");
  }
  const memos = Array.isArray(summary.memos)
    ? (summary.memos as Array<Record<string, unknown>>)
    : [];
  const pm = memos.find((m) => m.key === "p5/portfolio-manager");
  if (pm?.status !== "published") {
    failures.push(`PM memo not published (${String(pm?.status)})`);
  }

  if (failures.length === 0) {
    console.log(
      `PASS — NVDA fixture/fast completed with a decision (${String(summary.finalRating)}) ` +
        `+ published PM memo. Summary: ${SUMMARY_CAPTURE}`,
    );
    process.exit(0);
  }
}

console.error("FAIL —\n" + failures.join("\n"));
process.exit(1);
