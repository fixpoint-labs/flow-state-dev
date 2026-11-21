#!/usr/bin/env node
// FIX-2774 inbox split — retained spec evidence, not production code.
//
// Re-derives the two counted facts SPEC.md rests on, from the real tree:
//
// 1. The allowlist split. Every Shift Manager inventory entry is classified
//    once: FIX-2776's split (its own checker) with one correction, the
//    answer's follow (`lab-data.tsx` `settled`) moved from FIX-2777 to this
//    issue, because the answer call is this issue's.
// 2. The snapshot census. Every read of the snapshot's `inbox`, `asks` and
//    `boards` sections in `src/` (direct, or through the helpers that read
//    them), and every use of the answer call, outside `reads.ts` and
//    `derive.ts`, which FIX-2777 deletes. Each site is classified once.
//
//    The unit: a site is one token on one line. The same token twice on a
//    line is one site; two different tokens on a line are two sites (so
//    `TaskSession.tsx:48`, `waitsOnYou` and `asksOfTask`, is two). The
//    expected counts are in sites; the run also prints how many lines they
//    sit on.
//
// Totality on both: an entry or a site nobody classified fails the check, and
// so does a classification that names nothing.
//
//   node specs/issues/FIX-2774/poc/inbox-split/check.mjs              # check
//   node specs/issues/FIX-2774/poc/inbox-split/check.mjs --control    # plant an unclassified entry and site, expect FAIL
//   node specs/issues/FIX-2774/poc/inbox-split/check.mjs --built      # the goal check: this issue's expected counts set to 0
//
// `--built` is the spec's goal check, run on the implementation: this issue's
// allowlist entry and its 30 sites are expected gone (0), every other owner's
// count as before, and each site of this issue's still found is named. On
// today's `main` it fails, naming the 30.
//
// Exit 0: both totals hold and the counts are the spec's. Exit 1 otherwise.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const APP = join(ROOT, "packages/shift-manager");
const CONTROL = process.argv.includes("--control");
const BUILT = process.argv.includes("--built");
const failures = [];

// ── 1. The allowlist ─────────────────────────────────────────────────────
const allowlist = JSON.parse(readFileSync(join(APP, "test/inventory-allowlist.json"), "utf8"));
if (CONTROL) allowlist.push({ file: "src/lib/planted.ts", symbol: "Planted", kind: "type" });

/** FIX-2776's checker, by file (specs/issues/FIX-2776/poc/allowlist-split/check.mjs), less `lab-data.tsx`. */
const byFile = {
  "src/lib/action.ts": "FIX-2776",
  "src/lib/ask-session.ts": "FIX-2776",
  "src/lib/files.ts": "FIX-2776",
  "src/lib/run.ts": "FIX-2776",
  "src/lib/send.ts": "FIX-2776",
  "src/lib/task.tsx": "FIX-2776",
  "src/lib/delegates.ts": "FIX-2776",
  "src/components/flow-state/review-hold.tsx": "FIX-2776",
  "src/components/flow-state/run-checks.tsx": "FIX-2776",
  "src/components/flow-state/spend.tsx": "FIX-2776",
  "src/components/flow-state/task-actions.tsx": "FIX-2776",
  "src/components/flow-state/task-plan-state.ts": "FIX-2776",
  "src/lib/reads.ts": "FIX-2777",
  "src/lib/snapshot-subscribe.ts": "FIX-2777",
  "src/lib/derive.ts": "FIX-2777",
  "src/lib/messages.ts": "FIX-2775",
  "src/lib/projects.ts": "FIX-2775",
  "src/lib/routines.ts": "FIX-2775",
  "src/lib/usage.ts": "FIX-2775",
  "src/lib/mcp-credentials.ts": "FIX-2775",
};
/** The correction: `lab-data.tsx`'s one entry is the answer's follow, which goes with the answer call. */
const bySymbol = { "src/lib/lab-data.tsx#settled": "FIX-2774" };

const entryCounts = {};
const mineEntries = [];
for (const entry of allowlist) {
  const owner = bySymbol[`${entry.file}#${entry.symbol}`] ?? byFile[entry.file];
  if (owner === undefined) {
    failures.push(`allowlist entry unclassified: ${entry.file} ${entry.symbol} (${entry.kind})`);
    continue;
  }
  entryCounts[owner] = (entryCounts[owner] ?? 0) + 1;
  if (owner === "FIX-2774") mineEntries.push(entry);
}
for (const key of Object.keys(bySymbol)) {
  // Built, this issue's entry is gone: an override naming it names nothing, as it should.
  if (BUILT && bySymbol[key] === "FIX-2774") continue;
  if (!allowlist.some((e) => `${e.file}#${e.symbol}` === key)) failures.push(`override names no entry: ${key}`);
}
for (const file of Object.keys(byFile)) {
  if (!allowlist.some((e) => e.file === file)) failures.push(`classified but not on the allowlist: ${file}`);
}
const expectEntries = { "FIX-2776": 32, "FIX-2775": 16, "FIX-2777": 21, "FIX-2774": BUILT ? 0 : 1 };
if (BUILT) for (const e of mineEntries) failures.push(`still on the allowlist: ${e.file} ${e.symbol} (${e.kind})`);
for (const [owner, n] of Object.entries(expectEntries)) {
  if ((entryCounts[owner] ?? 0) !== n) failures.push(`allowlist: ${owner} owns ${entryCounts[owner] ?? 0}, the spec says ${n}`);
}

// ── 2. The snapshot census ───────────────────────────────────────────────
const SITE =
  /(?:snapshot|loaded)\??\.(?:inbox|asks|boards)\b|\b(?:allTasks|openTasks|boardOwnerOf|workerStates|shiftSummary|inboxItemIdOf|inboxItemAt|waitsOnYou|asksOfTask|tasksSummary|emptyInboxSentence)\(|reader\.readBoard\b/g;
const ANSWER = /const \{[^}]*\} = useLab\(\)/;
const ANSWER_NAMES = ["answerOne", "answered", "answer"];
const DELETED_WITH_SNAPSHOT = new Set(["src/lib/reads.ts", "src/lib/derive.ts"]);

/**
 * Owner by `file#token`. `(D2)` marks the sites the parity decision moves to
 * this issue; the owner's other answer leaves them with FIX-2776.
 */
const sites = {
  "src/surfaces/Inbox.tsx#snapshot.inbox": "FIX-2774",
  "src/surfaces/Inbox.tsx#inboxItemAt": "FIX-2774",
  "src/surfaces/Inbox.tsx#emptyInboxSentence": "FIX-2774",
  "src/surfaces/Inbox.tsx#answerOne": "FIX-2774",
  "src/components/AskCard.tsx#answer": "FIX-2774",
  "src/surfaces/Sidebar.tsx#loaded.inbox": "FIX-2774",
  "src/surfaces/Sidebar.tsx#openTasks": "FIX-2774",
  "src/surfaces/Tasks.tsx#openTasks": "FIX-2774",
  "src/surfaces/Tasks.tsx#snapshot.boards": "FIX-2774",
  "src/surfaces/Tasks.tsx#boardOwnerOf": "FIX-2774",
  "src/surfaces/Tasks.tsx#tasksSummary": "FIX-2774",
  "src/lib/tasks.ts#tasksSummary": "FIX-2774",
  "src/lib/tasks.ts#openTasks": "FIX-2774",
  "src/lib/tasks.ts#snapshot.inbox": "FIX-2774",
  "src/lib/tasks.ts#emptyInboxSentence": "FIX-2774",
  "src/surfaces/JumpTo.tsx#allTasks": "FIX-2774",
  "src/surfaces/ShiftCoordinator.tsx#shiftSummary": "FIX-2774",
  "src/surfaces/ShiftCoordinator.tsx#inboxItemIdOf": "FIX-2774",
  "src/surfaces/TaskInspector.tsx#inboxItemIdOf": "FIX-2774",
  "src/surfaces/TaskInspector.tsx#asksOfTask": "FIX-2774 (D2)",
  "src/surfaces/TaskSession.tsx#asksOfTask": "FIX-2774 (D2)",
  "src/surfaces/TaskSession.tsx#waitsOnYou": "FIX-2774 (D2)",
  "src/surfaces/TaskFrame.tsx#asksOfTask": "FIX-2774 (D2)",
  // The roster's on-shift computation: it reads this issue's view, and the directory child moves it.
  "src/surfaces/Sidebar.tsx#workerStates": "FIX-2775",
  "src/surfaces/Roster.tsx#workerStates": "FIX-2775",
  "src/surfaces/Roster.tsx#snapshot.boards": "FIX-2775",
  "src/surfaces/Roster.tsx#snapshot.asks": "FIX-2775",
  "src/surfaces/Project.tsx#workerStates": "FIX-2775",
  "src/surfaces/ShiftCoordinator.tsx#workerStates": "FIX-2775",
  "src/lib/tasks.ts#workerStates": "FIX-2775",
  // One task's row, through orchestration's task-list view, and the conversation's read-back.
  "src/lib/task.tsx#allTasks": "FIX-2776",
  "src/lib/task.tsx#snapshot.boards": "FIX-2776",
  "src/lib/task.tsx#reader.readBoard": "FIX-2776",
  "src/components/Conversation.tsx#answered": "FIX-2776",
};

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const found = [];
for (const path of walk(join(APP, "src"))) {
  const file = relative(APP, path);
  if (DELETED_WITH_SNAPSHOT.has(file)) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, at) => {
      for (const match of line.matchAll(SITE)) {
        found.push({ file, line: at + 1, token: match[0].replace(/\($/, "").replace("?.", ".") });
      }
      if (ANSWER.test(line)) {
        const names = line.slice(line.indexOf("{") + 1, line.indexOf("}")).split(",").map((s) => s.trim());
        for (const name of ANSWER_NAMES) if (names.includes(name)) found.push({ file, line: at + 1, token: name });
      }
    });
}
if (CONTROL) found.push({ file: "src/surfaces/Planted.tsx", line: 1, token: "snapshot.inbox" });

// One site per file, line and token: the same token twice on a line is one site; two tokens are two.
const distinct = [...new Map(found.map((s) => [`${s.file}:${s.line}:${s.token}`, s])).values()];
const siteCounts = {};
const seenKeys = new Set();
const mineSites = [];
for (const site of distinct) {
  const key = `${site.file}#${site.token}`;
  seenKeys.add(key);
  const owner = sites[key];
  if (owner === undefined) {
    failures.push(`census site unclassified: ${site.file}:${site.line} ${site.token}`);
    continue;
  }
  siteCounts[owner] = (siteCounts[owner] ?? 0) + 1;
  if (owner.startsWith("FIX-2774")) mineSites.push(`${site.file}:${site.line} ${site.token}${owner.endsWith("(D2)") ? "  (D2)" : ""}`);
}
// Built, this issue's sites are gone: a census key of its that names no site is what the change did.
for (const key of Object.keys(sites)) if (!seenKeys.has(key) && !(BUILT && sites[key].startsWith("FIX-2774"))) failures.push(`census names no site: ${key}`);
const expectSites = BUILT ? { "FIX-2774": 0, "FIX-2774 (D2)": 0, "FIX-2775": 8, "FIX-2776": 4 } : { "FIX-2774": 25, "FIX-2774 (D2)": 5, "FIX-2775": 8, "FIX-2776": 4 };
if (BUILT) for (const site of mineSites) failures.push(`still reads the snapshot: ${site}`);
for (const [owner, n] of Object.entries(expectSites)) {
  if ((siteCounts[owner] ?? 0) !== n) failures.push(`census: ${owner} has ${siteCounts[owner] ?? 0} sites, the spec says ${n}`);
}

console.log(`allowlist: ${allowlist.length} entries · ${JSON.stringify(entryCounts)}`);
for (const e of mineEntries) console.log(`  FIX-2774  ${e.file}  ${e.symbol}  (${e.kind})`);
const linesOf = (pick) => new Set(distinct.filter((s) => (sites[`${s.file}#${s.token}`] ?? "").startsWith(pick)).map((s) => `${s.file}:${s.line}`)).size;
console.log(`census: ${distinct.length} sites · ${JSON.stringify(siteCounts)}`);
console.log(`  FIX-2774 sites on ${linesOf("FIX-2774")} lines · its D2 sites on ${linesOf("FIX-2774 (D2)")} lines`);
for (const s of mineSites) console.log(`  ${s}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("PASS every entry and every site classified once");
