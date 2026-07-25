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
import { join } from "node:path";
import {
  KITCHEN_SINK,
  actualModel,
  answerText,
  assistantMessages,
  assistantText,
  goalTmpDir,
  loadFixture,
  readCapture,
  runFsdev,
  runGoal,
} from "../../lib/index.mts";

const CAPTURE = join(goalTmpDir("chat-agent"), "run.json");

// Held-out fixture. Nothing below hardcodes the question or the expected
// answer — the assertion reads `mustContain` from here, so swapping in a
// different valid question + answer must still pass a correct implementation.
const fixture = loadFixture<{ message: string; mustContain: string }>(
  import.meta.url,
  "question.json",
);

await runGoal(() => {
  // Drive the real path with a real model; capture the full stream + result.
  // No --model flag: the env's intent ladder / model resolver decides what runs
  // (this container may pin it via FSDEV_DEFAULT_MODEL). We record whatever the
  // assistant generator actually ran on, read back from the capture below.
  const exit = runFsdev({
    app: KITCHEN_SINK,
    flow: "chat-agent",
    action: "run",
    input: { message: fixture.message, mode: "ask" },
    capture: CAPTURE,
  });
  if (exit !== 0) return { failures: [`fsdev run exited ${exit}`], evidence: "" };

  // readCapture keeps the LATEST snapshot per item id — streamed assistant text
  // lands in later snapshots, so the first `item_added` is usually empty.
  const capture = readCapture(CAPTURE);
  if (capture.result.success !== true) {
    return {
      failures: [
        `flow did not complete: ${JSON.stringify(capture.result.error ?? capture.result ?? "unknown")}`,
      ],
      evidence: "",
    };
  }

  // The user-visible answer surface: assistant messages (role !== "user") and
  // the action's returned output. We assert on the CONTENT of these — not their
  // mere presence (see Anti-game in goal.md).
  const messages = assistantMessages(capture.items);
  const assistant = assistantText(capture.items);
  const output = String(capture.result.output ?? "");
  const needle = fixture.mustContain.toLowerCase();
  // The graded surface is `answerText` (assistant messages + terminal output),
  // the same helper `_template` and `structured-output` use. The two booleans
  // below are only for the evidence line — reporting WHERE the answer landed is
  // information `answerText` alone collapses.
  const inAssistant = assistant.toLowerCase().includes(needle);
  const inOutput = output.toLowerCase().includes(needle);

  const failures: string[] = [];
  // The check passes only when the held-out answer is actually present in the
  // answer text. An assistant message with no/other content does NOT pass — this
  // is the anti-game guard: emitting a message item is not enough.
  if (!answerText(capture).toLowerCase().includes(needle)) {
    failures.push(
      messages.length === 0
        ? "no assistant message emitted and output is empty"
        : `answer did not contain "${fixture.mustContain}". ` +
          `assistant text: ${JSON.stringify(assistant.slice(0, 200))}, ` +
          `output: ${JSON.stringify(output.slice(0, 200))}`,
    );
  }

  const where = [inAssistant && "assistant message", inOutput && "result.output"]
    .filter(Boolean)
    .join(" + ");
  return {
    failures,
    evidence:
      `answer contained "${fixture.mustContain}" in ${where} ` +
      `(model: ${actualModel(capture.items)}). Asserted on content, not message presence.`,
  };
});
