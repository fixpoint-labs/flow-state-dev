#!/usr/bin/env node
// FIX-1875 surface sweep. Retained spec evidence, not production code.
//
// Re-derives the spec's factual base from every tracked file (git ls-files),
// so a mention nobody listed still surfaces:
//
//   - RETIRED: the names FIX-1875 removes (`waitForResponse` and the public
//     ask names). After the implementation PR, none may remain outside history.
//   - STARTS: places that rely on `addTask` / `assignTask` starting work on a
//     conversation board: the `addTask_tasks` / `assignTask_tasks` actions,
//     scripted model calls (`toolName: "addTask"`), and worker files that tell a
//     model `addTask` starts the task. Each is a migration candidate the
//     implementer reviews (D1). Not caught: prose that names the tool without
//     backticks outside a WORKER.md. Re-read those by eye.
//
// A line that refuses a retired name on purpose (the BR-21 handler, its test)
// carries the marker `retired-name-refusal` and is not a live use.
//
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs            # inventory, exit 0
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs --assert   # exit 1 while a RETIRED name is live
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs --control  # plant an unclassified hit, expect exit 2
//   node specs/issues/FIX-1875/poc/surface-sweep/sweep.mjs --assert --plant-live  # plant live uses beside each allowed pass, expect exit 1 naming each
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
const REFUSAL_MARKER = "retired-name-refusal";
const ACTION_RE = /\b(addTask|assignTask)_tasks\b/;
const TOOL_CALL_RE = /toolName:\s*["'`](addTask|assignTask)["'`]/;
const WORKER_STARTS_RE = /`addTask`/;

// The three regression checks the epic's kill line names (ER-11).
const REGRESSION = [
  "goals/hand-offs/ask-survives-a-restart/",
  "goals/coordinators/task-session-stays-open/",
  "goals/hand-offs/survives-a-restart-and-runs-once/",
];

/**
 * A line that names a retired name and is live. Three passes are allowed, each
 * an exact shape, and each strips only what it allows before the line is
 * tested again, so a second retired name on the same line still counts:
 *
 * - Playwright's `.waitForResponse((r) => ...)`: a method of the browser API
 *   called with a predicate. Ours was only ever a field (`waitForResponse:`),
 *   never a call, so `addTask({ waitForResponse: true })` still counts.
 * - A goal's verdict-log row dated before the names were retired
 *   (`RETIRED_ON`): history, like a changelog. A row dated later counts.
 * - The published migration note in `apps/docs/`, a paragraph opening
 *   `**Moving from \`waitForResponse\`.**`: its backticked
 *   `waitForResponse` mentions say what replaces it. Any other retired name in
 *   it, and the same text anywhere else, counts.
 */
const RETIRED_ON = "2026-10-12";
const PLAYWRIGHT_WAIT_RE = /\.waitForResponse\(\(\w+\)\s*=>/g;
const VERDICT_ROW_RE = /^\| (\d{4}-\d{2}-\d{2}) \|/;
const MIGRATION_NOTE = "**Moving from `waitForResponse`.** ";

function isLiveRetired(p, line) {
  if (!RETIRED_RE.test(line) || line.includes(REFUSAL_MARKER)) return false;
  let rest = line.replace(PLAYWRIGHT_WAIT_RE, "");
  const row = /^goals\/.+\/goal\.md$/.test(p) ? VERDICT_ROW_RE.exec(line) : null;
  if (row !== null && row[1] < RETIRED_ON) return false;
  if (p.startsWith("apps/docs/") && line.startsWith(MIGRATION_NOTE)) rest = rest.replaceAll("`waitForResponse`", "");
  return RETIRED_RE.test(rest);
}

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
if (process.argv.includes("--plant-live")) {
  // Each narrowed pass, beside a live use it must not hide: every one of these
  // must be reported RETIRED (run with --assert; expect exit 1 and these paths).
  contents.set("goals/planted/tool-use.mts", "await page.waitForResponse((r) => r.ok());\naddTask({ goal: 'x', waitForResponse: true });");
  contents.set("goals/planted/call.mts", "const r = await tools.waitForResponse({ taskId });");
  contents.set("goals/planted/goal.md", "| 2026-10-13 | abc | model | PASS | used waitForResponse |");
  contents.set("packages/planted/README.md", "**Moving from `waitForResponse`.** Send `waitForResponse` to addTask.");
  contents.set("apps/docs/docs/planted.md", "**Moving from `waitForResponse`.** Call `addTaskAndWait`.");
}
if (process.argv.includes("--control")) {
  // The negative control: a hit in a path no bucket claims.
  contents.set("scratch/planted.txt", "addTask({ waitForResponse: true })");
}

const retired = new Map();
const starts = new Map();
const unclassified = [];
for (const [p, text] of contents) {
  const r = text.split("\n").some((line) => isLiveRetired(p, line));
  const s =
    ACTION_RE.test(text) || TOOL_CALL_RE.test(text) || (p.endsWith("/WORKER.md") && WORKER_STARTS_RE.test(text));
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
