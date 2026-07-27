/**
 * Goal check — the analysis pipeline refuses a non-equity symbol cleanly instead
 * of hallucinating a stock report (FIX-773).
 *
 * Real path: raw `fsdev run analysis analyze` on a bond CUSIP, then the zero-model
 * `runSummary` read-back, both `--capture --quiet`, from `labs/trading-desk` (the
 * `verify-trading-desk` two-step). The asset-type gate runs BEFORE any generator,
 * so this exercises the real pipeline entry but spends no model tokens — the proof
 * is that the run STOPPED at the gate with the right reason and message.
 *
 * Run: pnpm tsx goals/trading-desk-portfolio/gate-non-equity/run.mts
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

const SESSION = goalSessionId("gate");
const CAPTURE_DIR = goalTmpDir("desk-gate");
const SUMMARY_CAPTURE = join(CAPTURE_DIR, "summary.json");

await runGoal(() => {
  // A US Treasury CUSIP — a real holding shape with no exchange ticker. The gate
  // classifies it as a bond from its symbol shape (no provider call) and stops.
  // A non-zero exit is expected-ish here (the run stops, it does not complete),
  // so the verdict comes from the RunSummary, not the exit code.
  runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "analyze",
    input: { ticker: "912828YK0", dataSource: "fixture", costPreset: "fast" },
    session: SESSION,
    capture: join(CAPTURE_DIR, "analyze.json"),
    quiet: true,
  });

  const summaryExit = runFsdev({
    app: TRADING_DESK,
    flow: "analysis",
    action: "runSummary",
    session: SESSION,
    capture: SUMMARY_CAPTURE,
    quiet: true,
  });
  if (summaryExit !== 0) {
    return { failures: [`runSummary exited ${summaryExit}`], evidence: "" };
  }

  // The RunSummary is the action's output. (An earlier version searched the whole
  // capture recursively for a `{status, stopReason}` object; the summary action's
  // output IS that object, so read it directly.)
  const run = (readCapture(SUMMARY_CAPTURE).result.output ?? {}) as Record<string, unknown>;
  const failures: string[] = [];
  if (run.status !== "stopped") {
    failures.push(`expected status "stopped", got "${String(run.status)}"`);
  }
  if (run.stopReason !== "unsupported-asset-type") {
    failures.push(
      `expected stopReason "unsupported-asset-type", got "${String(run.stopReason)}"`,
    );
  }

  return {
    failures,
    evidence: `a bond CUSIP stopped at the asset-type gate — ${String(run.stopMessage)}`,
  };
});
