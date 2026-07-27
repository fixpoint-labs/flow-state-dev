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
import { join } from "node:path";
import {
  TRADING_DESK,
  goalSessionId,
  goalTmpDir,
  readCapture,
  runFsdev,
  runGoal,
} from "../../lib/index.mts";

const SESSION = goalSessionId("nvda");
const CAPTURE_DIR = goalTmpDir("desk-headless");
const SUMMARY_CAPTURE = join(CAPTURE_DIR, "summary.json");

await runGoal(() => {
  // 1. The real run. Exit 0 = ran (completed OR stopped); non-zero = errored.
  const analyzeExit = runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "analyze",
    input: { ticker: "NVDA", dataSource: "fixture", costPreset: "fast" },
    session: SESSION,
    capture: join(CAPTURE_DIR, "analyze.json"),
    quiet: true,
  });

  // 2. The zero-model read-back — the machine-readable RunSummary.
  const summaryExit = runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "runSummary",
    session: SESSION,
    capture: SUMMARY_CAPTURE,
    quiet: true,
  });

  const failures: string[] = [];
  if (analyzeExit !== 0) failures.push(`analyze exited ${analyzeExit}`);
  if (summaryExit !== 0) failures.push(`runSummary exited ${summaryExit}`);
  if (failures.length > 0) return { failures, evidence: "" };

  const summary = (readCapture(SUMMARY_CAPTURE).result.output ?? {}) as Record<string, unknown>;

  if (summary.status !== "completed") {
    failures.push(
      `status ${String(summary.status)} (${String(summary.error ?? summary.stopReason ?? "")})`,
    );
  }
  if (summary.finalRating == null) failures.push("completed but finalRating is null");

  const memos = Array.isArray(summary.memos)
    ? (summary.memos as Array<Record<string, unknown>>)
    : [];
  const pm = memos.find((m) => m.key === "p5/portfolio-manager");
  if (pm?.status !== "published") failures.push(`PM memo not published (${String(pm?.status)})`);

  return {
    failures,
    evidence:
      `NVDA fixture/fast completed with a decision (${String(summary.finalRating)}) ` +
      `+ published PM memo. Summary: ${SUMMARY_CAPTURE}`,
  };
});
