// FIX-2466 spec evidence: every timer in Shift Manager and the two labs, classified.
// Retained design evidence, not production code. Throwaway.
//
// Run from the repository root:
//   node specs/issues/FIX-2466/poc/app-polls/check.mjs
//   FIX2466_CONTROL=plant node specs/issues/FIX-2466/poc/app-polls/check.mjs   # must exit 1
//
// Totality: every non-test source file under the three apps' src trees is scanned. Each
// timer call (setTimeout, setInterval, requestAnimationFrame) and each call of a lab's
// read-again helper (`poll(` in Teammates, `every(` in claude-code-style) is a site. A site
// belongs to the nearest named owner above it (a lab verb, or a function declaration).
// Every `file#owner` must be classified below, and every classified key must still be found.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ROOTS = ["packages/shift-manager/src", "labs/teammates/src", "labs/claude-code-style/src"];
const TIMER = /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/;
const HELPER = { "labs/teammates/src/adapter.ts": /(^|[^\w.])poll(<[^>]*>)?\(/, "labs/claude-code-style/src/adapter.ts": /(^|[^\w.])every(<[^>]*>)?\(/ };
// An owner: a lab verb (`watchX(` or `watchX:`), or a named function declaration.
const OWNER = /^\s*(?:(watch[A-Z]\w*)\s*[(:]|(?:export )?(?:default )?(?:async )?function\*? (\w+))/;

/** Each owner of a timer, and what this spec does with it. */
const CLASSIFIED = {
  // Views this spec moves behind notices (or onto the session stream).
  "packages/shift-manager/src/lib/messages.ts#useMessages": "moves: message log, 5 s · user resource notice",
  "packages/shift-manager/src/lib/conversation.ts#useWorkerConversation": "moves: worker conversation items, 5 s · session stream",
  "packages/shift-manager/src/lib/projects.ts#useProjectRead": "moves: project row and entries, 5 s · user or org resource notice",
  "packages/shift-manager/src/lib/task.tsx#TaskProvider": "moves: task view waits for its run link, 2 s up to 30 · board notice (FIX-2429's publish)",
  "labs/teammates/src/adapter.ts#watchConversation": "moves: requests, 1.5 s · request notice (items already on the session stream)",
  "labs/teammates/src/adapter.ts#watchTalk": "moves: worker messages, 1.5 s · user resource notice",
  "labs/teammates/src/adapter.ts#watchActivity": "moves: requests, 1.5 s · request notice",
  "labs/teammates/src/adapter.ts#watchWindow": "moves: requests and history summary, 1.5 s · request and session resource notice",
  "labs/claude-code-style/src/adapter.ts#watchSessions": "moves: session rows, 3 s · each listed session's notices (D1: a new session has none)",
  "labs/claude-code-style/src/adapter.ts#watchThread": "moves: items and running turns, 1.5 s · session stream and request notice",
  "labs/claude-code-style/src/adapter.ts#watchTaskWork": "moves: a run's items, 2 s · session stream",
  "labs/claude-code-style/src/adapter.ts#watchPins": "moves: pins, 3 s, each read a request · user state notice",
  // Board views: FIX-2429's.
  "packages/shift-manager/src/components/TasksPanel.tsx#TasksPanel": "fix-2429: board panel",
  "packages/shift-manager/src/components/TaskBoardMeta.tsx#LiveBoard": "fix-2429: board card",
  "labs/teammates/src/adapter.ts#watchTasks": "fix-2429: board",
  "labs/claude-code-style/src/adapter.ts#watchTasks": "fix-2429: board",
  // Waits on one request the app sent or resumed: the request's own stream, not a notice (epic).
  "packages/shift-manager/src/lib/action.ts#runAction": "wait: an action's status, 150 ms up to 30 s",
  "packages/shift-manager/src/lib/send.ts#sendTurn": "wait: a sent line's status, 250 ms up to 130 s",
  "packages/shift-manager/src/lib/send.ts#stopWithin": "not a read: a deadline race",
  "packages/shift-manager/src/lib/run.ts#interruptRun": "wait: an interrupt's settle, 250 ms up to 30 s",
  "packages/shift-manager/src/lib/lab-data.tsx#settled": "wait: an answered ask's run, 1 s up to 130",
  // Not a read: clocks, animation, retry after a failure, the helpers' own timers.
  "packages/shift-manager/src/surfaces/TaskFrame.tsx#Elapsed": "not a read: a clock",
  "packages/shift-manager/src/surfaces/Tasks.tsx#useNow": "not a read: a clock",
  "packages/shift-manager/src/lib/theme.ts#bootTheme": "not a read: theme follow and fade",
  "packages/shift-manager/src/components/flow-state/code-block.tsx#(top)": "not a read: copy feedback",
  "packages/shift-manager/src/components/flow-state/reasoning.tsx#(top)": "not a read: auto-collapse",
  "packages/shift-manager/src/components/flow-state/debate.tsx#Debate": "not a read: animation frame",
  "labs/teammates/src/lib/use-watch.ts#useNow": "not a read: a clock",
  "labs/teammates/src/lib/session-feed.ts#follow": "not a read: retry a failed snapshot",
  "labs/teammates/src/adapter.ts#poll": "helper: the read-again timer the verbs above call",
  "labs/claude-code-style/src/lib/use-watch.ts#useNow": "not a read: a clock",
  "labs/claude-code-style/src/adapter.ts#every": "helper: the read-again timer the verbs above call",
};

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "test", "tests", "__tests__"]);
const SOURCE = /\.(ts|tsx|mts|js|mjs|jsx)$/;
const TEST_FILE = /\.(test|spec|type-test)\.[a-z]+$/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name) && !TEST_FILE.test(name)) out.push(path);
  }
}

const files = [];
for (const root of ROOTS) walk(join(ROOT, root), files);

const found = new Map(); // key -> site count
for (const file of files) {
  const rel = relative(ROOT, file);
  const helper = HELPER[rel];
  let owner = "(top)";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const named = OWNER.exec(line);
    if (named) owner = named.slice(1).find(Boolean);
    if (TIMER.test(line) || (helper && helper.test(line) && !/function (poll|every)</.test(line))) {
      const key = `${rel}#${owner}`;
      found.set(key, (found.get(key) ?? 0) + 1);
    }
  }
}

// Negative control: a timer nobody classified must fail the check.
if (process.env.FIX2466_CONTROL === "plant") found.set("labs/planted/src/view.ts#watchSomething", 1);

const unclassified = [...found.keys()].filter((key) => !(key in CLASSIFIED));
const stale = Object.keys(CLASSIFIED).filter((key) => !found.has(key));

let sites = 0;
for (const n of found.values()) sites += n;
console.log(`scanned ${files.length} source files; ${sites} timer sites under ${found.size} owners`);
for (const key of [...found.keys()].sort()) console.log(`  ${key} (${found.get(key)})  ->  ${CLASSIFIED[key] ?? "UNCLASSIFIED"}`);
const tally = {};
for (const key of found.keys()) {
  const role = (CLASSIFIED[key] ?? "UNCLASSIFIED").split(":")[0];
  tally[role] = (tally[role] ?? 0) + 1;
}
console.log(`by role: ${JSON.stringify(tally)}`);
if (unclassified.length > 0 || stale.length > 0) {
  if (unclassified.length > 0) console.error(`FAIL unclassified: ${unclassified.join(", ")}`);
  if (stale.length > 0) console.error(`FAIL classified but no longer found: ${stale.join(", ")}`);
  process.exit(1);
}
console.log("PASS every timer in the three apps is classified");
