#!/usr/bin/env node
// FIX-1875 surface sweep. Retained spec evidence, not production code.
//
// Re-derives the spec's factual base from every tracked file (git ls-files),
// so a mention nobody listed still surfaces:
//
//   - RETIRED: the names FIX-1875 removes (`waitForResponse` and the public
//     ask names). After the implementation PR, none may remain outside history.
//   - STARTS: places that rely on `addTask` / `assignTask` starting work on a
//     conversation board: the `addTask_tasks` / `assignTask_tasks` actions, and
//     worker files that tell a model `addTask` starts the task. Each is a
//     migration candidate the implementer reviews (D1).
//
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs            # inventory, exit 0
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs --assert   # exit 1 while a RETIRED name is live
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs --control  # plant an unclassified hit, expect exit 2
//
// Totality: every file with a hit must fall in exactly one bucket. A hit in no
// bucket exits 2, so a new kind of surface can't hide.
// On today's main, --assert must exit 1. After FIX-1875 merges, it must exit 0.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);

const RETIRED = [
  "waitForResponse",
  "addTaskAndWait",
  "AddTaskAndWaitOptions",
  "WaitForResponseResult",
  "canHoldAsk",
  "AskEndedError",
  "AskStoppedError",
  "DEFAULT_ASK_TIMEOUT_MS",
  "MIN_ASK_TIMEOUT_MS",
  "MAX_ASK_TIMEOUT_MS",
];
const RETIRED_RE = new RegExp(`\\b(${RETIRED.join("|")})\\b`);
const ACTION_RE = /\b(addTask|assignTask)_tasks\b/;
const WORKER_STARTS_RE = /`addTask`/;

// The three regression checks the epic's kill line names (ER-11).
const REGRESSION = [
  "goals/hand-offs/ask-survives-a-restart/",
  "goals/coordinators/task-session-stays-open/",
  "goals/hand-offs/survives-a-restart-and-runs-once/",
];

/** History may remember a name; it is never live. */
const isHistory = (p) =>
  p.startsWith("specs/") || p.startsWith(".changeset/") || p.endsWith("CHANGELOG.md") || p.startsWith("docs/internal/");

/** Exactly one bucket per path, or undefined. */
function bucketOf(p) {
  if (/(^|\/)(test|tests|__tests__)\//.test(p) || /\.test\.(ts|tsx|mts)$/.test(p)) return "test";
  if (p.startsWith("apps/docs/")) return "published-docs";
  if (/^packages\/[^/]+\/README\.md$/.test(p)) return "package-readme";
  if (p.endsWith("/WORKER.md")) return "worker-file";
  if (p.startsWith("goals/")) return REGRESSION.some((r) => p.startsWith(r)) ? "regression-check" : "goal-check";
  if (/^packages\/[^/]+\/(src|teams)\//.test(p)) return "package-source";
  if (p.startsWith("apps/")) return "app-source";
  if (p.startsWith("docs/")) return "repo-docs";
  if (p.startsWith(".agents/") || p.startsWith(".claude/")) return "agent-skills";
  return undefined;
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((p) => p !== "" && !isHistory(p) && /\.(ts|tsx|mts|mjs|md|mdx|json)$/.test(p));

const contents = new Map();
for (const p of files) {
  try {
    contents.set(p, readFileSync(p, "utf8"));
  } catch {
    // A tracked file deleted in the working tree: nothing to read.
  }
}
if (process.argv.includes("--control")) {
  // The negative control: a hit in a path no bucket claims.
  contents.set("scratch/planted.txt", "addTask({ waitForResponse: true })");
}

const retired = new Map();
const starts = new Map();
const unclassified = [];
for (const [p, text] of contents) {
  const r = RETIRED_RE.test(text);
  const s = ACTION_RE.test(text) || (p.endsWith("/WORKER.md") && WORKER_STARTS_RE.test(text));
  if (!r && !s) continue;
  const bucket = bucketOf(p);
  if (bucket === undefined) {
    unclassified.push(p);
    continue;
  }
  if (r) (retired.get(bucket) ?? retired.set(bucket, []).get(bucket)).push(p);
  if (s) (starts.get(bucket) ?? starts.set(bucket, []).get(bucket)).push(p);
}

const print = (title, map) => {
  const total = [...map.values()].reduce((n, l) => n + l.length, 0);
  console.log(`\n${title}: ${total} file(s)`);
  for (const [bucket, list] of [...map].sort()) {
    console.log(`  ${bucket} (${list.length})`);
    for (const p of list.sort()) console.log(`    ${p}`);
  }
  return total;
};
const retiredTotal = print("RETIRED names still live", retired);
print("STARTS: relies on addTask/assignTask starting work (review each)", starts);

if (unclassified.length > 0) {
  console.log(`\nUNCLASSIFIED: ${unclassified.length} file(s) with a hit in no bucket`);
  for (const p of unclassified) console.log(`  ${p}`);
  process.exit(2);
}
if (process.argv.includes("--assert") && retiredTotal > 0) {
  console.log(`\nFAIL: ${retiredTotal} file(s) still carry a retired name.`);
  process.exit(1);
}
console.log("\nOK");
