#!/usr/bin/env node
// FIX-2087 POC · the closure's surface sweep, run against a checkout.
//
// Retained design evidence for the closure spec, not production code. It answers one
// question before the closure is built: can "a fifth task tool", "a removed surface still
// live" and "an ending recorded outside the claim gate or the drain" be read off the
// source mechanically, with every site classified and none skipped?
//
// Three rules, each total over what it scans:
//   tools    every task tool the task-tools capability names is one of the four, answerTask
//            (until FIX-2058), or a name migration.md removes. An unknown name fails.
//   removed  no name in migration.md's "Removed" column is live in packages/*/src.
//   endings  every call of a task collection's complete() or fail() sits in an allowed
//            recorder. Any other call site fails.
//
// Usage: node sweep.mjs [--root <checkout>] [--control]
//   --control plants one unknown tool and one stray ending write in memory (never on disk)
//   and must report exactly those two more lines.
// Exit 0 = PASS (nothing live), 1 = FAIL.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const root = args.includes("--root") ? args[args.indexOf("--root") + 1] : process.cwd();
const control = args.includes("--control");

const KEPT = ["createTask", "getTask", "listTasks", "updateTask"];
const ALLOWED = ["answerTask"]; // FIX-2056 D2: a fifth tool until FIX-2058
const REMOVED_TOOLS = ["addTask", "dispatchTask", "readTask", "assignTask", "cancelTask", "completeTask", "failTask", "blockTask"];
const REMOVED_NAMES = ["settleSplitTask", "DELEGATED_POST_ENTRY", "onDelegatedPost"];
const REMOVED_METHODS = ["block", "unblock", "reopen"]; // TaskCollection members, migration.md
const TOOLS_FILE = "packages/orchestration/src/skills/task-tools-capability.ts";
const COLLECTION_TYPES = "packages/orchestration/src/tasks/collection/types.ts";
// The recorders allowed to write an ending, each with its reason. Rule 18: the claim gate for
// a dispatched row, the drain for an inline one. Patterns keep their own boards' recorders
// (FIX-2056 SPEC.md, "What stays as it is"), so their recording steps are the drain there.
const RECORDERS = {
  "packages/orchestration/src/task-board/blocks/record-result.ts": "the claim gate's recorder",
  "packages/orchestration/src/tasks/collection/advisory-write-back.ts": "the gate's write helper, called only by record-result",
  "packages/patterns/src/debate/blocks/record-argument.ts": "a pattern's own inline recorder (patterns stay)",
  "packages/patterns/src/round-robin/blocks/record-contribution.ts": "a pattern's own inline recorder (patterns stay)",
  "packages/patterns/src/routedSpecialists/index.ts": "a pattern's own inline recorder (patterns stay)",
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const pkgs = join(root, "packages");
const files = readdirSync(pkgs).flatMap((p) => {
  const src = join(pkgs, p, "src");
  try { return statSync(src).isDirectory() ? walk(src) : []; } catch { return []; }
});
const source = new Map(files.map((f) => [relative(root, f), readFileSync(f, "utf8")]));
if (control) {
  source.set(TOOLS_FILE, `${source.get(TOOLS_FILE)}\n    name: named("pokeTask"),\n`);
  source.set("packages/workforce/src/planted.ts", "await rows.complete(taskId, output);\n");
}

const findings = [];
const scanned = { tools: 0, removed: 0, endings: 0 };
const isCode = (line) => !/^\s*(\/\/|\*|\/\*)/.test(line);

// tools · every named tool classified
for (const m of (source.get(TOOLS_FILE) ?? "").matchAll(/name:\s*named\("(\w+)"\)/g)) {
  scanned.tools++;
  const n = m[1];
  if (KEPT.includes(n) || ALLOWED.includes(n)) continue;
  findings.push(`tools: ${n} ${REMOVED_TOOLS.includes(n) ? "is removed by migration.md and still offered" : "is not one of the four, answerTask or a removed name"}`);
}

// removed · live names, and the collection's removed members
for (const [path, text] of source) {
  text.split("\n").forEach((line, i) => {
    if (!isCode(line)) return;
    for (const n of REMOVED_NAMES) {
      if (new RegExp(`\\b${n}\\b`).test(line)) { scanned.removed++; findings.push(`removed: ${n} live at ${path}:${i + 1}`); }
    }
    if (path === COLLECTION_TYPES) {
      for (const n of REMOVED_METHODS) {
        if (new RegExp(`^\\s+${n}\\(`).test(line)) { scanned.removed++; findings.push(`removed: TaskCollection.${n} declared at ${path}:${i + 1}`); }
      }
    }
  });
}

// endings · every complete()/fail() on a collection outside the recorders
const ENDING = /\b(\w+)\.(complete|fail)\(\s*[\w.]*[tT]ask[\w.]*(Id)?\b/;
for (const [path, text] of source) {
  text.split("\n").forEach((line, i) => {
    if (!isCode(line) || !ENDING.test(line)) return;
    scanned.endings++;
    if (!(path in RECORDERS)) findings.push(`endings: ${line.match(ENDING)[0]} at ${path}:${i + 1}`);
  });
}

console.log(`scanned: ${files.length} files · tools ${scanned.tools} · removed hits ${scanned.removed} · ending writes ${scanned.endings}`);
if (scanned.tools === 0 || scanned.endings === 0) { console.log("CAN'T TELL — a rule read nothing"); process.exit(3); }
if (findings.length === 0) { console.log("PASS — no task tool beyond the four and answerTask, nothing removed is live, every ending write is a recorder's"); process.exit(0); }
console.log(`FAIL — ${findings.length} live lines`);
for (const f of findings) console.log(`  - ${f}`);
process.exit(1);
