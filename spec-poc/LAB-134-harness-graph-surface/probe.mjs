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
const resultByCallId = new Map();
for (const m of messages) {
  if (m.type === "system" && m.subtype === "init") {
    cliVersion = m.claude_code_version ?? null;
    availableTools = m.tools ?? [];
  }
  if (m.type === "user") {
    for (const b of m.message?.content ?? []) {
      if (b.type === "tool_result") resultByCallId.set(b.tool_use_id, b.content);
    }
  }
}

const fileMutations = [];
const planCalls = [];
for (const m of messages) {
  if (m.type !== "assistant") continue;
  for (const b of m.message?.content ?? []) {
    if (b.type !== "tool_use") continue;
    const record = {
      tool: b.name,
      inputKeys: Object.keys(b.input ?? {}),
      input: b.input,
      result: resultByCallId.get(b.id),
      resultIsStructured: typeof resultByCallId.get(b.id) !== "string",
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
  console.log(`     result is structured? ${f.resultIsStructured}  -> ${JSON.stringify(f.result)?.slice(0, 120)}`);
}
console.log(`\nplan calls (${planCalls.length}):`);
for (const p of planCalls) {
  console.log(`  ${p.tool}  input=${JSON.stringify(p.input)}`);
  console.log(`     -> ${JSON.stringify(p.result)}`);
}

console.log("\n=== the three things the spec rests on ===");
const pathOnInput = fileMutations.every((f) => typeof f.input?.file_path === "string");
console.log(
  `1. file path is on the tool INPUT (not the result): ${fileMutations.length > 0 ? pathOnInput : "no file mutations observed"}`,
);
console.log(
  `2. tool results are prose, not the declared structured Output: ${fileMutations.every((f) => !f.resultIsStructured)}`,
);
console.log(
  `3. the todo surface is: ${[...new Set(planCalls.map((p) => p.tool))].join(" + ") || "(the run kept no todo list)"}`,
);

rmSync(workDir, { recursive: true, force: true });
