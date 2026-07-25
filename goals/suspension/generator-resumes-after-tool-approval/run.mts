/**
 * Goal check — a REAL model's generator tool loop suspends for approval and,
 * on resume, continues past the approved tool call on the same request.
 *
 * Real path, REAL model (no mock), out of CI. See goal.md for the contract.
 *
 * This is the real-model complement to the deterministic engine suite
 * (`packages/engine/test/generator-suspension-resume.test.ts`), which proves
 * the same behaviour with a scripted `stepModel`. The value here is exercising
 * the REAL AI-SDK adapter's `generateStep` / framework-owned tool-loop
 * suspension path (FIX-814 PR3) end to end:
 *   1. dispatch  → the real model calls the single gated tool; the tool calls
 *                  ctx.suspend() at the turn boundary → the request suspends
 *                  BEFORE the tool's real work runs.
 *   2. approve   → mark the suspension approved with a distinct operator
 *                  payload (the approver id — NOT the tool's result).
 *   3. resume    → the SAME request rebuilds its conversation from the durable
 *                  item log (step 0 is NOT re-issued to the model), re-enters
 *                  the gated tool which now produces its REAL result (a
 *                  held-out confirmation id), and the model writes a final
 *                  answer that quotes that id.
 *
 * The grade is content-based and anti-game: passing requires the tool to have
 * actually executed AFTER approval — the final answer must carry the tool's
 * held-out confirmation id (which the model could not produce without the tool
 * running post-approval), the tool's side effect must have fired exactly once,
 * and the model must NOT have been re-called for step 0 (the first model call
 * on resume already carries the tool result). None of `status==="completed"`,
 * a suspension merely existing, or the approval payload being echoed can
 * satisfy it. See the Anti-game note in goal.md.
 *
 * The dispatch and the resume must happen in ONE process (the in-memory durable
 * store carries the suspension between them) with cwd = apps/kitchen-sink (only
 * there do `@flow-state-dev/*` and `@ai-sdk/gateway` both resolve). That is
 * `harness.mts`; this file owns the grading and the retry policy.
 *
 * Run: pnpm tsx goals/suspension/generator-resumes-after-tool-approval/run.mts
 */
import {
  KITCHEN_SINK,
  gatewayModel,
  goalAttempts,
  goalModel,
  loadFixture,
  runGoal,
  runHarness,
} from "../../lib/index.mts";

// The harness builds its own gateway-bound resolver, so the model id must name
// the gateway. openai/gpt-5.4-mini via the Vercel gateway.
const MODEL = goalModel(gatewayModel());
const MAX_ATTEMPTS = goalAttempts(3);

// Held-out fixture — nothing below hardcodes the title, confirmation id, or
// approver. Swapping them for any other valid triple must still pass a correct
// implementation: the runner reads them from the fixture and asserts against
// what it read.
const fixture = loadFixture<{ title: string; confirmationId: string; approver: string }>(
  import.meta.url,
  "publish.json",
);

interface Observation {
  ok: boolean;
  reason?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  sideEffects?: number;
  sideEffectsAtSuspend?: number;
  initialModelCalls?: number;
  resumeModelCalls?: number;
  firstResumeToolResults?: number;
}

await runGoal(() => {
  let lastFlaky = "";

  // A real model is nondeterministic. This retries the MODEL's decision to call
  // the gated tool — never the resume mechanism, which is what the goal proves.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = runHarness<Observation>({
      app: KITCHEN_SINK,
      harness: new URL("./harness.mts", import.meta.url),
      env: {
        FSD_ENV: "dev",
        KS_GOAL_MODEL: MODEL,
        KS_GOAL_TITLE: fixture.title,
        KS_GOAL_CONFIRMATION_ID: fixture.confirmationId,
        KS_GOAL_APPROVER: fixture.approver,
      },
    });

    // Model flakiness (not a bug): the model didn't call the gated tool, so no
    // suspension occurred. Retry rather than fail — the resume path was never
    // exercised. A genuine driver error (ok:false, other reason) fails now.
    if (result.ok !== true) {
      if (typeof result.reason === "string" && result.reason.includes("did not suspend")) {
        lastFlaky = `attempt ${attempt}: ${result.reason} (status=${result.status}, output=${JSON.stringify(result.output)})`;
        console.error(`(retrying) ${lastFlaky}`);
        continue;
      }
      return { failures: [result.reason ?? "driver reported failure"], evidence: "" };
    }
    if (result.error) {
      return { failures: [`resume errored: ${JSON.stringify(result.error)}`], evidence: "" };
    }

    // --- The goal grade: held-out, content-based, anti-game -----------------
    const output = result.output;
    const outputStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
    const failures: string[] = [];

    // (a) The tool ACTUALLY RAN AFTER APPROVAL — the final answer quotes the
    //     tool's held-out confirmation id, which the model never saw except as
    //     the tool's post-approval result. This is the core anti-game signal.
    if (!outputStr.includes(fixture.confirmationId)) {
      failures.push(
        `final answer is missing the tool's held-out confirmation id "${fixture.confirmationId}" — ` +
          `the approved tool did not run post-approval, or its real result never reached the model`,
      );
    }
    // (b) The final answer must NOT merely echo the approval payload. If the
    //     approver id appears but the confirmation id does not, that is a payload
    //     echo, not the tool's result. (Belt-and-suspenders with (a).)
    if (outputStr.includes(fixture.approver) && !outputStr.includes(fixture.confirmationId)) {
      failures.push(
        `final answer echoed the approval payload "${fixture.approver}" instead of the tool's real result`,
      );
    }
    // (c) Request reached completion on the same request id.
    if (result.status !== "completed") {
      failures.push(`resumed request status is "${result.status}", expected "completed"`);
    }
    // (d) The tool's side effect fired exactly once — nothing before approval,
    //     exactly one execution total. Not zero (payload echoed), not two (loop
    //     re-ran the pre-suspension work).
    if (result.sideEffectsAtSuspend !== 0) {
      failures.push(
        `tool did real work BEFORE approval (sideEffectsAtSuspend=${result.sideEffectsAtSuspend}); the gate did not run first`,
      );
    }
    if (result.sideEffects !== 1) {
      failures.push(`tool side effect fired ${result.sideEffects} times, expected exactly 1`);
    }
    // (e) The model was NOT re-called for step 0 on resume. A correct resume
    //     rebuilds step 0 from the durable log and re-enters the model at step 1
    //     WITH the gated tool's result already in the messages — so the first
    //     resume-phase model call must carry >=1 tool result. Step 0 (initial)
    //     is exactly one model call, before the suspend.
    if (result.initialModelCalls !== 1) {
      failures.push(
        `expected exactly 1 model call before suspend (step 0), saw ${result.initialModelCalls}`,
      );
    }
    if ((result.resumeModelCalls ?? 0) < 1) {
      failures.push(
        `expected the model to be re-called on resume (step 1+), saw ${result.resumeModelCalls} resume-phase calls`,
      );
    }
    if ((result.firstResumeToolResults ?? -1) < 1) {
      failures.push(
        `first resume-phase model call carried ${result.firstResumeToolResults} tool results — ` +
          `step 0 appears to have been re-issued to the model instead of replayed from the durable log`,
      );
    }

    if (failures.length > 0) failures.push(`resumed output: ${outputStr}`);

    return {
      failures,
      evidence:
        `a real ${MODEL} generator suspended inside its owned tool loop for approval and, on resume, ` +
        `continued past the approved call on the same request. ` +
        `Evidence: tool ran exactly once (0 before approval, 1 after); step 0 was replayed from the durable log ` +
        `(${result.initialModelCalls} model call before suspend, first resume call carried ` +
        `${result.firstResumeToolResults} tool result → step 0 NOT re-called); request reached "completed"; and the ` +
        `final answer quotes the tool's held-out confirmation id "${fixture.confirmationId}" (not the approval payload). ` +
        `Final answer: ${outputStr}` +
        (attempt > 1 ? ` [passed on attempt ${attempt}; earlier flakiness: ${lastFlaky}]` : ""),
    };
  }

  return {
    failures: [
      `model did not call the gated tool in ${MAX_ATTEMPTS} attempts (no suspension induced) — last: ${lastFlaky}`,
    ],
    evidence: "",
  };
});
