/**
 * Goal check — the fsdev chat harness holds a conversation.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Drives `fsdev chat hello-chat chat` over piped stdin against the real model
 * wired into examples/hello-chat, and asserts the assistant's answer to a
 * question ("What is my name?") — isolated from turn 1 via an intervening
 * /status block — recovered a name only turn 1 established. That the second
 * reply knows the name proves history threaded through the persistent session.
 *
 * Run: pnpm tsx goals/chat-harness/holds-a-conversation/run.mts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HELLO_CHAT = fileURLToPath(new URL("../../../examples/hello-chat", import.meta.url));

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/conversation.json", import.meta.url), "utf8"),
) as { name: string; statement: string; question: string };

// statement → /status (Turns: 1) → question → /status (Turns: 2) → /exit.
// The /status between the turns is the delimiter that isolates the second reply.
const stdin = [fixture.statement, "/status", fixture.question, "/status", "/exit", ""].join("\n");

// The harness resolves the real model through examples/hello-chat's config.
// Clear the ambient default-model override so createModelResolver auto-wires the
// available provider gateway instead of rejecting on an intent-less override.
const env = { ...process.env };
delete env.FSDEV_DEFAULT_MODEL;
delete env.FSDEV_INTENT_PLAN;
delete env.FSDEV_INTENT_REASON;

const result = spawnSync("pnpm", ["fsdev", "chat", "hello-chat", "chat"], {
  cwd: HELLO_CHAT,
  input: stdin,
  env,
  encoding: "utf8",
});

const transcript = result.stdout ?? "";
process.stdout.write(transcript);
if (result.stderr) process.stderr.write(result.stderr);

const failures: string[] = [];

if (result.status !== 0) {
  failures.push(`exited ${result.status} (expected 0)`);
}

const firstStatus = transcript.indexOf("Turns:   1");
const secondStatus = transcript.indexOf("Turns:   2");
if (firstStatus === -1 || secondStatus === -1) {
  failures.push("both /status blocks (Turns: 1 then Turns: 2) were not present");
}
if (!/Target:\s+hello-chat · chat/.test(transcript)) {
  failures.push("/status did not name the hello-chat · chat target");
}
if (!/Session:\s+sess_/.test(transcript)) {
  failures.push("/status did not name a session id");
}

// Isolate the reply to the QUESTION: the segment between the end of the first
// /status block (its Store: line) and the start of the second (its Target: line).
let secondReply = "";
if (firstStatus !== -1 && secondStatus !== -1) {
  const storeLineEnd = transcript.indexOf("\n", transcript.indexOf("Store:", firstStatus));
  const secondTargetStart = transcript.lastIndexOf("Target:", secondStatus);
  secondReply = transcript.slice(storeLineEnd + 1, secondTargetStart);
}

if (secondReply.trim().length === 0) {
  failures.push("the reply to the question was empty");
} else if (!secondReply.toLowerCase().includes(fixture.name.toLowerCase())) {
  failures.push(
    `the reply to the question did not contain "${fixture.name}" — history did not thread. ` +
      `Second reply: ${JSON.stringify(secondReply.slice(0, 200))}`,
  );
}

if (failures.length === 0) {
  console.log(
    `\nPASS — the answer to "${fixture.question}" contained "${fixture.name}", recovered from turn-1 history ` +
      `(not the current prompt). Both /status blocks named the session and target.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —\n" + failures.join("\n"));
  process.exit(1);
}
