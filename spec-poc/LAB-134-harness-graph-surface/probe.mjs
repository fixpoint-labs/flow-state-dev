/**
 * Characterization probe — what does a real coding run's message stream
 * actually carry for file writes and for the agent's own todo list?
 *
 * THROWAWAY. Nothing here ships. It exists so the spec's central premise is a
 * measured fact rather than a reading of type declarations, and so a reviewer
 * can re-measure it instead of taking the spec's word.
 *
 * It drives the real `claude` CLI in stream-json mode. That is the same wire
 * protocol the Agent SDK yields from `query()` — the SDK spawns this binary,
 * and its manifest pins the version (check `manifest.json` in the installed
 * `@anthropic-ai/claude-agent-sdk` against the `cliVersion` printed below; if
 * they differ, the finding needs re-measuring, which is the whole point of
 * printing it).
 *
 * Run: node spec-poc/LAB-134-harness-graph-surface/probe.mjs
 * Needs: an authenticated `claude` on PATH. Writes only to a temp directory.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Tool names that, if they appear, would carry a file mutation. */
const FILE_MUTATION_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
/** Every tool name we have seen a harness use to express a todo list. */
const PLAN_TOOL_CANDIDATES = new Set([
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);

const workDir = mkdtempSync(join(tmpdir(), "graph-surface-"));
const streamPath = join(workDir, "stream.ndjson");

const job =
  "Make a todo list with exactly two items, then do them: " +
  "(1) create a file notes.txt in this directory containing the single line HELLO-PROBE, " +
  "then (2) change that line to HELLO-PROBE-EDITED. " +
  "Mark each todo in_progress then completed as you go. Then say done.";

console.log(`running a real coding job in ${workDir} ...`);
const proc = spawnSync(
  "claude",
  [
    "-p", job,
    "--output-format", "stream-json",
    "--verbose",
    "--allowed-tools", "Write", "Edit", "TodoWrite", "Read",
    "--permission-mode", "acceptEdits",
    "--max-turns", "12",
  ],
  { cwd: workDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (proc.status !== 0) {
  console.error(`claude exited ${proc.status}`);
  console.error(proc.stderr?.slice(0, 2000) ?? "");
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
}

const messages = proc.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

let cliVersion = null;
let availableTools = [];
/** The string content sent to the MODEL — `tool_result.content` on the block. */
const resultByCallId = new Map();
/**
 * The message-level `tool_use_result` — declared on `SDKUserMessage` as "the
 * tool's full Output object, not the string content sent to the model".
 * A sibling of the block content above, and a different question: the two must
 * be measured separately or a finding about one gets stated about both.
 */
const structuredByCallId = new Map();
for (const m of messages) {
  if (m.type === "system" && m.subtype === "init") {
    cliVersion = m.claude_code_version ?? null;
    availableTools = m.tools ?? [];
  }
  if (m.type === "user") {
    for (const b of m.message?.content ?? []) {
      if (b.type !== "tool_result") continue;
      resultByCallId.set(b.tool_use_id, b.content);
      if (m.tool_use_result !== undefined) {
        structuredByCallId.set(b.tool_use_id, m.tool_use_result);
      }
    }
  }
}

const fileMutations = [];
const planCalls = [];
for (const m of messages) {
  if (m.type !== "assistant") continue;
  for (const b of m.message?.content ?? []) {
    if (b.type !== "tool_use") continue;
    const structured = structuredByCallId.get(b.id);
    const record = {
      tool: b.name,
      inputKeys: Object.keys(b.input ?? {}),
      input: b.input,
      // What the MODEL saw.
      result: resultByCallId.get(b.id),
      resultContentIsString: typeof resultByCallId.get(b.id) === "string",
      // What the message carried alongside it, if anything.
      structured,
      structuredPresent: structured !== undefined,
      structuredKeys: structured && typeof structured === "object" ? Object.keys(structured) : [],
    };
    if (FILE_MUTATION_TOOLS.has(b.name)) fileMutations.push(record);
    if (PLAN_TOOL_CANDIDATES.has(b.name)) planCalls.push(record);
  }
}

const report = {
  cliVersion,
  todoWriteOffered: availableTools.includes("TodoWrite"),
  planToolsOffered: availableTools.filter((t) => PLAN_TOOL_CANDIDATES.has(t)),
  fileMutations,
  planCalls,
};

console.log("\n=== what the wire carried ===");
console.log(`cliVersion               ${report.cliVersion}`);
console.log(`TodoWrite offered?       ${report.todoWriteOffered}`);
console.log(`plan tools offered       ${report.planToolsOffered.join(", ") || "(none)"}`);
console.log(`\nfile mutations (${fileMutations.length}):`);
for (const f of fileMutations) {
  console.log(`  ${f.tool}  input=[${f.inputKeys.join(", ")}]  path=${f.input?.file_path}`);
  console.log(`     tool_result.content (to the model): ${JSON.stringify(f.result)?.slice(0, 100)}`);
  console.log(`     tool_use_result present? ${f.structuredPresent}  keys=[${f.structuredKeys.join(", ")}]`);
}
console.log(`\nplan calls (${planCalls.length}):`);
for (const p of planCalls) {
  console.log(`  ${p.tool}  input=${JSON.stringify(p.input)}`);
  console.log(`     tool_result.content: ${JSON.stringify(p.result)}`);
  console.log(`     tool_use_result:     ${JSON.stringify(p.structured)}`);
}

console.log("\n=== the four things the spec rests on ===");
const pathOnInput = fileMutations.every((f) => typeof f.input?.file_path === "string");
console.log(
  `1. file path is on the tool INPUT: ${fileMutations.length > 0 ? pathOnInput : "no file mutations observed"}`,
);
console.log(
  `2. tool_result.content (what the model sees) is a prose string: ${fileMutations.every((f) => f.resultContentIsString)}`,
);
console.log(
  `3. tool_use_result (the structured Output, a SEPARATE field) is present: ` +
    `files=${fileMutations.filter((f) => f.structuredPresent).length}/${fileMutations.length} ` +
    `plan=${planCalls.filter((p) => p.structuredPresent).length}/${planCalls.length}`,
);
const creates = planCalls.filter((p) => p.tool === "TaskCreate");
const idsTyped = creates.filter(
  (p) => typeof p.structured?.task?.id === "string" || typeof p.structured?.task?.id === "number",
);
console.log(
  `4. a created todo's id is readable from a typed field (no prose parsing): ` +
    `${creates.length > 0 ? `${idsTyped.length}/${creates.length}` : "no creates observed"}`,
);

console.log("\n=== the todo surface ===");
console.log(
  `   ${[...new Set(planCalls.map((p) => p.tool))].join(" + ") || "(the run kept no todo list)"}`,
);

rmSync(workDir, { recursive: true, force: true });
