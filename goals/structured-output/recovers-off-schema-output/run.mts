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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CAPTURE = "/tmp/pae-glm-goal.json";
const MODEL = "vercel/zai/glm-5.2";
const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));

// Held-out fixture. Nothing below hardcodes the topic or the answer — only that
// the run completed through plan-and-execute with real content.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/goal.json", import.meta.url), "utf8"),
) as { message: string; minAnswerChars: number };

function messageText(item: any): string {
  const c = item?.content ?? item?.text ?? "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).join(" ");
  }
  return String(c);
}

execFileSync(
  "pnpm",
  [
    "fsdev", "run", "chat-agent", "run",
    "-i", JSON.stringify({ message: fixture.message, mode: "ask", thinkingStyle: "plan-and-execute" }),
    "--model", MODEL,
    "--capture", CAPTURE,
  ],
  { stdio: "inherit", cwd: KITCHEN_SINK },
);

const captured = JSON.parse(readFileSync(CAPTURE, "utf8"));
const failures: string[] = [];

// 1) The run completed — no execution_error. This is the headline: pre-fix it
//    aborts here.
if (captured.result?.success !== true) {
  failures.push(
    `run did not complete: ${JSON.stringify(captured.result?.error ?? captured.result ?? "unknown")}`,
  );
}

const items: any[] = (captured.events ?? [])
  .filter((e: any) => e.type === "item_added")
  .map((e: any) => e.item);

// 2) It actually went through plan-and-execute (anti-game: not the default
//    thinking style). task-change / task-board-meta components are emitted only
//    by the task-board substrate the pattern runs on.
const planItems = items.filter(
  (i) => i.type === "component" && (i.component === "task-change" || i.component === "task-board-meta"),
);
if (planItems.length === 0) {
  failures.push("no plan-and-execute items (task-change / task-board-meta) — the replan loop did not run");
}

// 3) The synthesized answer has real content (anti-game: not an empty message).
const assistantText = items
  .filter((i) => i.type === "message" && i.role !== "user")
  .map(messageText)
  .join("\n");
const outputText = String(captured.result?.output ?? "");
const answer = `${assistantText}\n${outputText}`.trim();
if (answer.length < fixture.minAnswerChars) {
  failures.push(
    `answer too short (${answer.length} < ${fixture.minAnswerChars} chars): ${JSON.stringify(answer.slice(0, 200))}`,
  );
}

if (failures.length === 0) {
  console.log(
    `PASS — plan-and-execute completed on ${MODEL}: ${planItems.length} plan items, ` +
      `${answer.length}-char answer. Off-schema replan-loop output was recovered, not fatal.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  process.exit(1);
}
