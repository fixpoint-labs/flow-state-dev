// Retained spec evidence for FIX-2624, not production code. Run: bash specs/issues/FIX-2624/poc/helper-inventory/run.sh
//
// Re-derives the spec's counted facts: every line of product source that names one of the four
// own-session helpers, and what replaces each use. Totality: a line the search finds that no rule
// classifies fails the run, so a new use can't hide. POC_PLANT=1 plants an unclassified use and
// the run must fail (the negative control).
import { execFileSync } from "node:child_process";

const SEARCH =
  "(\\bownSessions?\\b|\\blabSessions?\\b|\\brunLab\\b|\\brosterSession\\b|(^|[^.\\w])roster\\(\\)|\\breaderSessionId\\b|\\bopenReaderSession\\b|\\bopeningReaders\\b|\\bwithReaderSessions\\b|(^|[^.\\w])projects\\(\\))";
const PATHS = ["packages/*/src/**", "labs/*/src/**", "labs/*/*.mts", "apps/**", ":!**/test/**", ":!**/*.test.*"];

// Classes. "view" needs FIX-2623's user-scope views; every other class is FIX-2624's alone.
const CLASSES = {
  helper: "the helper itself: its cache, its open, its id; deleted with it",
  "direct-read": "a read of a user or org resource: becomes a direct read",
  "runby-write": "an action that writes a user or org resource: becomes a send to its runBy flow",
  identity: "learns the caller's org from the session: becomes the identity read",
  view: "reads by running an action that computes, not stores: becomes a view (FIX-2623)",
  carrier: "passes the session id along to a call classified elsewhere; goes with it",
  unrelated: "the same word for something else (a run's own session, the roster flow, the public roster read)",
};

// [file prefix, line regex, class(es)]
const RULES = [
  // claude-code-style: ownSession. Gone in 3c: listProjects (a direct read by scope) and createProject
  // (a send to the projects collection, run by its runBy flow, PROJECTS_FLOW).
  // Gone in 3c: the repository check (the projects flow's `checkRepository` view).
  // workforce client: the public roster read. Gone in 3c: the roster session (a workstream's entry is a direct read).
  ["packages/workforce/src/workers/client.ts", /^\s*roster\(\): Promise/, ["unrelated"]],
  ["packages/workforce/src/workers/register.ts", /copies\.push\(roster\(\)/, ["unrelated"]],
  ["packages/workforce/src/agent-worker-flow.ts", /`roster\(\)` row/, ["unrelated"]],
  ["packages/workforce/src/hire.ts", /`roster\(\)` row/, ["unrelated"]],
  // Shift Manager: readerSessionId. Gone in 3b: the project setup (a view), the message log (a direct
  // read), the organization (the identity read) and the worker inventory (a direct read). Gone in 3d: usage
  // (the usage flow's view, and Re-check through its runBy) and routines (the roster flow's routines view,
  // and pause and delete through the collections' runBy). Gone in 3c: the projects and a project's entries
  // (direct reads), an entry's report (the roster flow's `workstreamReport` view), the reader sessions'
  // open, and the snapshot's filter for them.
  ["packages/shift-manager/src/lib/reads.ts", /through Workforce's `roster\(\)`/, ["unrelated"]],
  // Same word, another meaning: a run's own session in the engine and orchestration.
  ["packages/engine/src/", /ownSession/, ["unrelated"]],
  ["packages/orchestration/src/", /ownSession/, ["unrelated"]],
];

function search() {
  const out = execFileSync("git", ["grep", "-nE", SEARCH, "--", ...PATHS], { encoding: "utf8", maxBuffer: 1 << 24 });
  const lines = out.split("\n").filter(Boolean);
  if (process.env.POC_PLANT === "1") lines.push("labs/claude-code-style/src/adapter.ts:9999:  const planted = await ownSession(\"new-flow\");");
  return lines.map((line) => {
    const [file, n, ...rest] = line.split(":");
    return { file, line: Number(n), text: rest.join(":") };
  });
}

const found = search();
const unclassified = [];
const byClass = Object.fromEntries(Object.keys(CLASSES).map((c) => [c, []]));
for (const hit of found) {
  const rule = RULES.find(([prefix, re]) => hit.file.startsWith(prefix) && re.test(hit.text));
  if (rule === undefined) {
    unclassified.push(hit);
    continue;
  }
  for (const c of rule[2]) byClass[c].push(hit);
}

// Rules that match nothing are stale: the spec would be counting a use that's gone.
const stale = RULES.filter(([prefix, re]) => !found.some((hit) => hit.file.startsWith(prefix) && re.test(hit.text)));

console.log(`Lines found: ${found.length}`);
for (const [c, hits] of Object.entries(byClass)) {
  const files = new Set(hits.map((h) => h.file.split("/").slice(0, 2).join("/")));
  console.log(`  ${c.padEnd(12)} ${String(hits.length).padStart(3)}  ${[...files].join(", ")}  (${CLASSES[c]})`);
}
const sites = (c) => byClass[c].map((h) => `    ${h.file}:${h.line}  ${h.text.trim().slice(0, 110)}`).join("\n");
console.log("\nUses that need a view (FIX-2623) before their helper can go:\n" + sites("view"));
console.log("\nUses that write through a flow:\n" + sites("runby-write"));
console.log("\nUses that learn the org:\n" + sites("identity"));

let failed = false;
if (unclassified.length > 0) {
  failed = true;
  console.log(`\nFAIL: ${unclassified.length} unclassified use(s):`);
  for (const h of unclassified) console.log(`  ${h.file}:${h.line}  ${h.text.trim()}`);
}
// POC_EXPECT=gone is the after-deletion check: rules that match nothing are expected then, and
// any hit outside `unrelated` means a helper use survived.
const expectGone = process.env.POC_EXPECT === "gone";
const live = Object.entries(byClass).filter(([c, hits]) => c !== "unrelated" && hits.length > 0);
if (expectGone && live.length > 0) {
  failed = true;
  console.log(`\nFAIL: helper uses remain: ${live.map(([c, h]) => `${c}=${h.length}`).join(", ")}`);
}
if (!expectGone && stale.length > 0) {
  failed = true;
  console.log(`\nFAIL: ${stale.length} stale rule(s), matching nothing:`);
  for (const [prefix, re] of stale) console.log(`  ${prefix}  ${re}`);
}
if (failed) process.exit(1);
console.log(expectGone ? "\nPASS: no helper use remains; every hit is unrelated." : "\nPASS: every use classified, every rule still matches.");
