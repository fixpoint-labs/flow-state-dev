// FIX-2429 spec evidence: every place that reads a task board for a screen, classified.
// Retained design evidence, not production code. Throwaway.
//
// Run from the repository root:
//   node specs/issues/FIX-2429/poc/board-views/check.mjs
//   FIX2429_CONTROL=plant node specs/issues/FIX-2429/poc/board-views/check.mjs   # must exit 1
//
// Totality: every non-test source file under packages/*/src, labs/*/src and apps/*
// that reads a board (the listTasks read, the Shift Manager reader, the live board
// driver) must be classified below, and every classified file must still match.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const PATTERN = /listTasks_tasks|\bLIST_TASKS\b|LIST_TASKS_ACTION|readConversationTasks\(|liveBoardDriver\(/;

/** Each file that reads a board, and what this spec does with it. */
const CLASSIFIED = {
  // Board views this spec moves behind board notices.
  "packages/shift-manager/src/components/TasksPanel.tsx": "moves: TASKS panel, 3 s poll while a task is open or just moved",
  "packages/shift-manager/src/components/TaskBoardMeta.tsx": "moves: LiveBoard, 3 s poll while a task is open",
  "labs/teammates/src/adapter.ts": "moves: watchTasks, 1.5 s read while a running row names no run",
  "labs/claude-code-style/src/adapter.ts": "moves: watchTasks, 2 s poll, always",
  "packages/react/src/components/panels/reads.ts": "moves: BoardList live, follows one session's items",
  // Not a view: the shared reader the two Shift Manager views call.
  "packages/shift-manager/src/lib/conversation-tasks.ts": "reader: readConversationTasks, called by the two views above",
  // Not a view: the server side that declares the read.
  "packages/workforce/src/conversation-board/board.ts": "server: declares the read",
  "packages/workforce/src/conversation-board/session-board.ts": "server: declares the read",
};

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "test", "tests", "__tests__", ".turbo"]);
const SOURCE = /\.(ts|tsx|mts|js|mjs|jsx)$/;
const TEST_FILE = /\.(test|spec|type-test)\.[a-z]+$/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (SOURCE.test(name) && !TEST_FILE.test(name)) out.push(path);
  }
}

const roots = [];
for (const group of ["packages", "labs"]) {
  for (const name of readdirSync(join(ROOT, group))) roots.push(join(ROOT, group, name, "src"));
}
for (const name of readdirSync(join(ROOT, "apps"))) roots.push(join(ROOT, "apps", name));

const files = [];
for (const root of roots) walk(root, files);
const matched = files.filter((file) => PATTERN.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file));

// Negative control: a board reader nobody classified must fail the check.
if (process.env.FIX2429_CONTROL === "plant") matched.push("labs/planted/src/unclassified-board-view.ts");

const unclassified = matched.filter((file) => !(file in CLASSIFIED));
const stale = Object.keys(CLASSIFIED).filter((file) => !matched.includes(file));

console.log(`scanned ${files.length} source files; ${matched.length} read a board`);
for (const file of matched.sort()) console.log(`  ${file}  ->  ${CLASSIFIED[file] ?? "UNCLASSIFIED"}`);
const views = Object.values(CLASSIFIED).filter((role) => role.startsWith("moves:")).length;
console.log(`board views that move: ${views}`);
if (unclassified.length > 0 || stale.length > 0) {
  if (unclassified.length > 0) console.error(`FAIL unclassified: ${unclassified.join(", ")}`);
  if (stale.length > 0) console.error(`FAIL classified but no longer reads a board: ${stale.join(", ")}`);
  process.exit(1);
}
console.log("PASS every board reader is classified");
