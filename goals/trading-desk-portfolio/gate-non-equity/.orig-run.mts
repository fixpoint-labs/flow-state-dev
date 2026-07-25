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
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SESSION = `goal_gate_${Date.now()}`;
const CAPTURE_DIR = `${APP}/.fsdev/headless`;
const SUMMARY_CAPTURE = `${CAPTURE_DIR}/${SESSION}.summary.json`;

mkdirSync(CAPTURE_DIR, { recursive: true });

function fsdev(args: string[]): number {
  try {
    execFileSync("pnpm", ["fsdev", "run", "analysis", ...args], { stdio: "inherit", cwd: APP });
    return 0;
  } catch (err) {
    return typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 1;
  }
}

// A US Treasury CUSIP — a real holding shape with no exchange ticker. The gate
// classifies it as a bond from its symbol shape (no provider call) and stops.
fsdev([
  "analyze",
  "-i",
  '{"ticker":"912828YK0","dataSource":"fixture","costPreset":"fast"}',
  "--session",
  SESSION,
  "--capture",
  `${CAPTURE_DIR}/${SESSION}.analyze.json`,
  "--quiet",
]);

// Zero-model read-back of what happened.
fsdev(["runSummary", "-i", "{}", "--session", SESSION, "--capture", SUMMARY_CAPTURE, "--quiet"]);

const summary = JSON.parse(readFileSync(SUMMARY_CAPTURE, "utf8")) as Record<string, unknown>;
// The RunSummary is nested under the capture's result.output.
function dig(o: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || o == null || typeof o !== "object") return null;
  const rec = o as Record<string, unknown>;
  if ("status" in rec && "stopReason" in rec) return rec;
  for (const v of Object.values(rec)) {
    const found = dig(v, depth + 1);
    if (found) return found;
  }
  return null;
}
const run = dig(summary);
if (run === null) {
  console.error("FAIL: could not find a RunSummary in the capture.");
  process.exit(1);
}
if (run.status !== "stopped" || run.stopReason !== "unsupported-asset-type") {
  console.error(
    `FAIL: expected stopped/unsupported-asset-type, got status=${String(run.status)} ` +
      `stopReason=${String(run.stopReason)}.`,
  );
  process.exit(1);
}
console.log(`PASS: a bond CUSIP stopped at the asset-type gate — ${String(run.stopMessage)}`);
process.exit(0);
