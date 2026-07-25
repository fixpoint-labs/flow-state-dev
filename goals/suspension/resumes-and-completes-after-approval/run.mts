/**
 * Goal check — suspension resumes and completes after approval.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Drives kitchen-sink's `requestApproval` durable action end to end against the
 * real checkpoint durability provider:
 *   1. dispatch  → the durable gate suspends
 *   2. approve   → mark the suspension approved with the operator's note
 *                  (exactly what the resume endpoint / DevTool persists)
 *   3. resume    → the same request runs past the gate and completes
 *
 * It grades the RESUMED output's content against the held-out fixture — proving
 * the approved branch ran with the injected note and the original request
 * survived the suspend — not just that the run reported "completed" (see the
 * Anti-game note in goal.md).
 *
 * `requestApproval` is pure handlers + ctx.suspend(); there is no LLM call, so
 * no model credential is needed. The thing under test is the durable
 * suspend/resume/replay path, not a generator.
 *
 * The round trip must happen in ONE process (the in-memory dev store carries
 * the suspension between phases) with cwd = apps/kitchen-sink (only there do
 * both `@/*` and `@flow-state-dev/*` resolve). That is what `harness.mts` is;
 * this file owns the grading.
 *
 * Run: pnpm tsx goals/suspension/resumes-and-completes-after-approval/run.mts
 */
import { KITCHEN_SINK, loadFixture, runGoal, runHarness } from "../../lib/index.mts";

// Held-out fixture — nothing below hardcodes the request or note.
const fixture = loadFixture<{ request: string; note: string }>(import.meta.url, "approval.json");

interface Observation {
  ok: boolean;
  reason?: string;
  output?: unknown;
  status?: string;
  error?: unknown;
}

await runGoal(() => {
  const result = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      FSD_ENV: "dev",
      KS_GOAL_REQUEST: fixture.request,
      KS_GOAL_NOTE: fixture.note,
    },
    // The app's own runtime resolves the models it declares; keep its ladder.
    keepIntents: true,
  });

  if (result.ok !== true) return { failures: [result.reason ?? "driver reported failure"], evidence: "" };
  if (result.error) return { failures: [`resume errored: ${JSON.stringify(result.error)}`], evidence: "" };

  // --- The goal grade: resumed OUTPUT content, graded against the fixture ----
  // The action's output is a structured object ({ request, approvalId, approved,
  // note }); serialize it so the held-out request + note are graded as content
  // regardless of whether output is an object or a string.
  const output = result.output;
  const outputStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
  const failures: string[] = [];

  if (!outputStr.toLowerCase().includes(fixture.request.toLowerCase())) {
    failures.push(`output missing the original request "${fixture.request}" — input did not survive the suspend`);
  }
  if (!outputStr.toLowerCase().includes(fixture.note.toLowerCase())) {
    failures.push(`output missing the approver note "${fixture.note}" — the approve payload did not flow through on resume`);
  }
  if (result.status !== "completed") {
    failures.push(`resumed request status is "${result.status}", expected "completed"`);
  }
  if (failures.length > 0) failures.push(`resumed output: ${outputStr}`);

  return {
    failures,
    evidence:
      `requestApproval suspended, was approved, and resumed to completion. ` +
      `Resumed output carried both the held-out request and note: ${outputStr}. ` +
      `Graded on output content, not the completion flag or the suspension's presence.`,
  };
});
