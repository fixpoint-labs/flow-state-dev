/**
 * Goal check — chat-agent answers a factual question.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Drives the kitchen-sink `chat-agent` flow's `run` action with a real model
 * and asserts the held-out answer survived into the user-visible surface — the
 * assistant message content and/or the action's returned output.
 *
 * Run: pnpm tsx goals/chat-agent/answers-a-factual-question/run.mts
 *
 * The run shells `fsdev` with cwd = apps/kitchen-sink because config search is
 * cwd-only — the app's real wiring (intent ladder, gateway, stores) only
 * applies when fsdev is invoked from the app directory.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CAPTURE = "/tmp/chat-goal.json";
const KITCHEN_SINK = fileURLToPath(
  new URL("../../../apps/kitchen-sink", import.meta.url),
);

// Held-out fixture. Nothing below hardcodes the question or the expected
// answer — the assertion reads `mustContain` from here, so swapping in a
// different valid question + answer must still pass a correct implementation.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/question.json", import.meta.url), "utf8"),
) as { message: string; mustContain: string };

// Pull the text out of a message item's content, whether it's a bare string,
// an array of content parts ({ type, text }), or a `text` field.
function messageText(item: any): string {
  const c = item?.content ?? item?.text ?? "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).join(" ");
  }
  return String(c);
}

// Drive the real path with a real model; capture the full stream + result.
// No --model flag: the env's intent ladder / model resolver decides what runs
// (this container may pin it via FSDEV_DEFAULT_MODEL). We record whatever the
// assistant generator actually ran on, read back from the capture below.
execFileSync(
  "pnpm",
  [
    "fsdev", "run", "chat-agent", "run",
    "-i", JSON.stringify({ message: fixture.message, mode: "ask" }),
    "--capture", CAPTURE,
  ],
  { stdio: "inherit", cwd: KITCHEN_SINK },
);

// `fsdev run --capture` writes { command, events, result }. The item stream is
// the `item_added` events; the action's final output is on `result`.
const captured = JSON.parse(readFileSync(CAPTURE, "utf8"));

const failures: string[] = [];

if (captured.result?.success !== true) {
  console.error(
    `FAIL — flow did not complete: ${JSON.stringify(captured.result?.error ?? captured.result ?? "unknown")}`,
  );
  process.exit(1);
}

const items: any[] = (captured.events ?? [])
  .filter((e: any) => e.type === "item_added")
  .map((e: any) => e.item);

// The user-visible answer surface: assistant messages (role !== "user") and
// the action's returned output. We assert on the CONTENT of these — not their
// mere presence (see Anti-game in goal.md).
const assistantMessages = items.filter(
  (i) => i.type === "message" && i.role !== "user",
);
const assistantText = assistantMessages.map(messageText).join("\n");
const outputText = String(captured.result?.output ?? "");
const answer = `${assistantText}\n${outputText}`;

const needle = fixture.mustContain.toLowerCase();
const inAssistant = assistantText.toLowerCase().includes(needle);
const inOutput = outputText.toLowerCase().includes(needle);

// The check passes only when the held-out answer is actually present in the
// answer text. An assistant message with no/other content does NOT pass — this
// is the anti-game guard: emitting a message item is not enough.
if (!answer.toLowerCase().includes(needle)) {
  if (assistantMessages.length === 0) {
    failures.push("no assistant message emitted and output is empty");
  } else {
    failures.push(
      `answer did not contain "${fixture.mustContain}". ` +
        `assistant text: ${JSON.stringify(assistantText.slice(0, 200))}, ` +
        `output: ${JSON.stringify(outputText.slice(0, 200))}`,
    );
  }
}

if (failures.length === 0) {
  // Record the model the assistant generator actually ran on.
  const ranModel =
    assistantMessages.map((m) => m?.model?.actual).find(Boolean) ?? "unknown";
  const where = [inAssistant && "assistant message", inOutput && "result.output"]
    .filter(Boolean)
    .join(" + ");
  console.log(
    `PASS — answer contained "${fixture.mustContain}" in ${where} ` +
      `(model: ${ranModel}). Asserted on content, not message presence.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  process.exit(1);
}
