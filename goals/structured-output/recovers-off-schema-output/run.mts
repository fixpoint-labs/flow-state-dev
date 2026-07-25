/**
 * Goal check — structured output recovers from off-schema model output (FIX-841).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Drives the kitchen-sink `chat-agent` flow's `run` action with the
 * plan-and-execute thinking style on GLM 5.2, and asserts the run COMPLETED
 * through plan-and-execute with substantive content — proving the replan-loop
 * model's off-schema output was recovered, not fatal. Pre-fix, the run aborts
 * with an `execution_error` (AI_NoObjectGeneratedError).
 *
 * Run: pnpm tsx goals/structured-output/recovers-off-schema-output/run.mts
 *
 * `--model` forces every generator (including the coercion repair call) onto
 * GLM 5.2 — see goal.md for the realistic `intent/utility` variant. Shelled
 * with cwd = apps/kitchen-sink because config search is cwd-only.
 */
import { join } from "node:path";
import {
  KITCHEN_SINK,
  answerText,
  goalModel,
  goalTmpDir,
  loadFixture,
  readCapture,
  runFsdev,
  runGoal,
} from "../../lib/index.mts";

const CAPTURE = join(goalTmpDir("structured-output"), "run.json");
// Pinned deliberately: this is the model that surfaced the bug. Not a default —
// do not substitute it for the corpus-wide DEFAULT_MODEL.
const MODEL = goalModel("vercel/zai/glm-5.2");

// Held-out fixture. Nothing below hardcodes the topic or the answer — only that
// the run completed through plan-and-execute with real content.
const fixture = loadFixture<{ message: string; minAnswerChars: number }>(
  import.meta.url,
  "goal.json",
);

await runGoal(() => {
  runFsdev({
    app: KITCHEN_SINK,
    flow: "chat-agent",
    action: "run",
    input: { message: fixture.message, mode: "ask", thinkingStyle: "plan-and-execute" },
    model: MODEL,
    capture: CAPTURE,
  });

  const capture = readCapture(CAPTURE);
  const failures: string[] = [];

  // 1) The run completed — no execution_error. This is the headline: pre-fix it
  //    aborts here.
  if (capture.result.success !== true) {
    failures.push(
      `run did not complete: ${JSON.stringify(capture.result.error ?? capture.result ?? "unknown")}`,
    );
  }

  // 2) It actually went through plan-and-execute (anti-game: not the default
  //    thinking style). task-change / task-board-meta components are emitted only
  //    by the task-board substrate the pattern runs on.
  const planItems = capture.items.filter(
    (i) =>
      i.type === "component" &&
      (i.component === "task-change" || i.component === "task-board-meta"),
  );
  if (planItems.length === 0) {
    failures.push(
      "no plan-and-execute items (task-change / task-board-meta) — the replan loop did not run",
    );
  }

  // 3) The synthesized answer has real content (anti-game: not an empty message).
  const answer = answerText(capture);
  if (answer.length < fixture.minAnswerChars) {
    failures.push(
      `answer too short (${answer.length} < ${fixture.minAnswerChars} chars): ${JSON.stringify(answer.slice(0, 200))}`,
    );
  }

  return {
    failures,
    evidence:
      `plan-and-execute completed on ${MODEL}: ${planItems.length} plan items, ` +
      `${answer.length}-char answer. Off-schema replan-loop output was recovered, not fatal.`,
  };
});
