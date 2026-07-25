/**
 * Goal check — suspension resumes after a cold restart.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Unlike the warm sibling (resumes-and-completes-after-approval, one in-memory
 * runtime), this proves the durable guarantee across a process restart:
 *   Process A: dispatch kitchen-sink's `requestApproval` against an on-disk store
 *              → suspends at the gate; the suspension is persisted to disk.
 *   Process B: a FRESH runtime over the SAME on-disk store dir (the cold restart)
 *              → loads the prior runtime's suspension (asserts it's still pending),
 *              approves it, and resumes the same request to completion.
 *
 * It grades the resumed output's content against the held-out fixture (request
 * + note), and requires the reloaded suspension to have survived as `pending`
 * — proving cross-restart persistence, not a brand-new suspension (see goal.md
 * Anti-game). `requestApproval` has no LLM, so no model credential is needed.
 *
 * The two processes are `harness-suspend.mts` and `harness-resume.mts`, each run
 * with cwd = apps/kitchen-sink (only there do `@/*` and `@flow-state-dev/*` both
 * resolve), sharing one throwaway on-disk store directory. This file owns the
 * grading and the cleanup.
 *
 * Run: pnpm tsx goals/suspension/resumes-after-a-cold-restart/run.mts
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  KITCHEN_SINK,
  goalTmpDir,
  loadFixture,
  runGoal,
  runHarness,
} from "../../lib/index.mts";

const fixture = loadFixture<{ request: string; note: string }>(import.meta.url, "approval.json");
const SCRATCH = goalTmpDir("cold-restart");
const DATA_DIR = join(SCRATCH, "stores");

interface SuspendObservation {
  ok: boolean;
  reason?: string;
  requestId?: string;
  sessionId?: string;
  suspensionId?: string;
}
interface ResumeObservation {
  ok: boolean;
  reason?: string;
  foundPending?: boolean;
  output?: unknown;
  status?: string;
  error?: unknown;
}

// Both harnesses build a minimal runtime with no declared model intents
// (requestApproval has no generator), so the intent-ladder overrides are
// stripped — runHarness does that by default.
const baseEnv = {
  FSD_ENV: "dev",
  KS_GOAL_DIR: DATA_DIR,
  KS_GOAL_REQUEST: fixture.request,
  KS_GOAL_NOTE: fixture.note,
};

await runGoal(() => {
  try {
    // Process A — suspend, persisted to disk.
    const a = runHarness<SuspendObservation>({
      app: KITCHEN_SINK,
      harness: new URL("./harness-suspend.mts", import.meta.url),
      env: baseEnv,
    });
    if (a.ok !== true) return { failures: [a.reason ?? "suspend phase failed"], evidence: "" };

    // Process B — cold restart: a fresh runtime over the persisted store dir.
    const b = runHarness<ResumeObservation>({
      app: KITCHEN_SINK,
      harness: new URL("./harness-resume.mts", import.meta.url),
      env: {
        ...baseEnv,
        KS_GOAL_REQUEST_ID: a.requestId!,
        KS_GOAL_SESSION_ID: a.sessionId!,
        KS_GOAL_SUSPENSION_ID: a.suspensionId!,
      },
    });
    if (b.ok !== true) return { failures: [b.reason ?? "resume phase failed"], evidence: "" };
    if (b.error) return { failures: [`resume errored: ${JSON.stringify(b.error)}`], evidence: "" };

    // --- Grade -------------------------------------------------------------
    const output = typeof b.output === "string" ? b.output : JSON.stringify(b.output ?? "");
    const failures: string[] = [];
    if (b.foundPending !== true) {
      failures.push(
        "the prior runtime's suspension did not reload as pending in the fresh runtime — it did not survive the cold restart",
      );
    }
    if (!output.toLowerCase().includes(fixture.request.toLowerCase())) {
      failures.push(`resumed output missing the original request "${fixture.request}"`);
    }
    if (!output.toLowerCase().includes(fixture.note.toLowerCase())) {
      failures.push(
        `resumed output missing the approver note "${fixture.note}" — approve payload did not flow through after the restart`,
      );
    }
    if (b.status !== "completed") {
      failures.push(`resumed request status is "${b.status}", expected "completed"`);
    }
    if (failures.length > 0) failures.push(`resumed output: ${output}`);

    return {
      failures,
      evidence:
        `suspension survived a cold restart: process A suspended and persisted to disk; a fresh ` +
        `process B reloaded it as pending, approved, and resumed to completion. Resumed output carried ` +
        `both the held-out request and note: ${output}. Graded on cross-restart persistence + output content.`,
    };
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true });
  }
});
