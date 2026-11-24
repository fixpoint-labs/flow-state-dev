#!/usr/bin/env node
// Retained design evidence for specs/issues/FIX-2877, not production code.
// Throwaway: nothing imports it, it edits nothing, it needs no install.
//
// Question: does every piece of Shift Manager's own coding flow have a place
// on the shared `coder` flow, and do Teammates' four default-coder knobs
// exist where the issue says? The spec's option table rests on this list.
//
//   node specs/issues/FIX-2877/poc/option-map/check.mjs
//   OPTION_MAP_CONTROL=1 node specs/issues/FIX-2877/poc/option-map/check.mjs   # must FAIL
//
// Totality: every option key of `CoderWorkerFlowOptions` and `CoderHarness`,
// every setting key the fork adds, and every action the fork declares, gets
// exactly one class. An unclassified key fails; so does a classified key that
// no longer exists (a stale map). The control plants an option key and must fail.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../../../../${p}`, import.meta.url), "utf8");
const fork = read("packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts");
const kit = read("packages/harness-manager/src/kit/coder-flow.ts");
const kitConfig = read("packages/harness-manager/src/kit/harnesses-kit.ts");

/** Keys of `export interface <name> { … }`, top level only. */
function interfaceKeys(source, name) {
  const start = source.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`no interface ${name}`);
  let depth = 0, i = source.indexOf("{", start), body = "";
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    if (c === "}") depth--;
    body += c;
    if (depth === 0) break;
  }
  // Strip comments, then read `key?:` / `key:` at depth 1.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const keys = [];
  let d = 0;
  for (const line of clean.split("\n")) {
    const m = d === 1 ? line.match(/^\s*([A-Za-z_]\w*)\??:/) : null;
    if (m) keys.push(m[1]);
    for (const c of line) { if (c === "{" || c === "(") d++; if (c === "}" || c === ")") d--; }
  }
  return keys;
}

/** Action names the fork's `defineFlow` declares: public, internal and task. */
function forkActions(source) {
  const flow = source.slice(source.indexOf("return defineFlow({"));
  const names = [...flow.matchAll(/^\s*(\[[A-Z_]+\]|[A-Za-z]+): (?:\{\s*$|message,|messageReceivedEntry\(|steerTurnEntry\(|workerTaskEntry\()/gm)]
    .map((m) => m[1])
    .filter((n) => !["actions", "internal", "task"].includes(n));
  return names;
}

// The kit option each piece maps to (HAS), the option the spec adds (GAINS), or why it goes (DROP).
const MAP = {
  // CoderWorkerFlowOptions
  installation: ["HAS", "workerFlow hands the installation to the flow"],
  harness: ["HAS", "the harnesses slot holds it, and defaultHarness names it"],
  harnessName: ["HAS", "defaultHarness"],
  harnesses: ["HAS", "the harnesses slot: one list for the coder and readiness"],
  workspace: ["HAS", "workspace; a fixed repository becomes a workspace host on it"],
  answerWorkspace: ["GAINS", "modes: the answer mode's workspace"],
  phase: ["GAINS", "modes: the implement mode"],
  answerPhase: ["GAINS", "modes: the answer mode"],
  judge: ["DROP", "the kit's judge is goalJudge on the same model and floor (0.7); only the block name differs"],
  onPullRequestRecorded: ["HAS", "onPullRequestRecorded, built on the installation"],
  reviewChanges: ["HAS", "review"],
  approveTools: ["GAINS", "approveTools"],
  runTimeoutMs: ["HAS", "runTimeoutMs, one budget per app"],
  stopsOnAbort: ["DROP", "a harness block declares it (HarnessBlock.stopsOnAbort), which the manager already reads"],
  resources: ["GAINS", "the app's own settings, documents and actions on the coder flow"],
  // CoderHarness (per named harness)
  "CoderHarness.slot": ["HAS", "a Harness value's agent"],
  "CoderHarness.runTimeoutMs": ["DROP", "one budget per app; the stub's shorter budget goes"],
  "CoderHarness.stopsOnAbort": ["DROP", "declared on the harness block"],
  // Settings the fork's configSchema adds to workerConfigSchema()
  "setting.harness": ["HAS", "the kit's harness enum over the filled ids"],
  "setting.document": ["GAINS", "the app's own settings, documents and actions on the coder flow"],
  // Actions
  "[INSPECT_ENTRY]": ["GAINS", "the app's own settings, documents and actions on the coder flow"],
  respond: ["HAS", "respond (the door)"],
  onTaskSteered: ["HAS", "onTaskSteered"],
  onMessageReceived: ["HAS", "onMessageReceived"],
  work: ["HAS", "the work task entry"],
};

const found = [
  ...interfaceKeys(fork, "CoderWorkerFlowOptions"),
  ...interfaceKeys(fork, "CoderHarness").map((k) => `CoderHarness.${k}`),
  ...(fork.includes("[HARNESS_SETTING]: z") ? ["setting.harness"] : []),
  ...(read("packages/shift-manager/teams/devteam/worker-config.mts").includes("[DOCUMENT_KEY]: z") ? ["setting.document"] : []),
  ...forkActions(fork),
];
if (process.env.OPTION_MAP_CONTROL === "1") found.push("plantedOption");

const problems = [];
for (const key of found) if (!(key in MAP)) problems.push(`UNCLASSIFIED: ${key}`);
for (const key of Object.keys(MAP)) if (!found.includes(key)) problems.push(`STALE (no longer in the fork): ${key}`);
const dupes = found.filter((k, i) => found.indexOf(k) !== i);
for (const d of new Set(dupes)) problems.push(`TWICE: ${d}`);

// Every HAS must name an option the kit really has today.
const kitKeys = interfaceKeys(kit, "CoderFlowOptions");
const has = { defaultHarness: 1, workspace: 1, review: 1, runTimeoutMs: 1, onPullRequestRecorded: 1 };
for (const k of Object.keys(has)) if (!kitKeys.includes(k)) problems.push(`KIT LACKS: ${k}`);
if (!kitConfig.includes("slots: { harnesses: slot.keyed(")) problems.push("KIT LACKS: the harnesses slot");
// And every GAINS names something it lacks today.
for (const k of ["approveTools", "modes"]) if (kitKeys.includes(k)) problems.push(`KIT ALREADY HAS: ${k}`);

// Teammates' four knobs, and the two harness lists, where the issue says.
const tm = {
  "TEAMMATES_HARNESS feeds harness": [read("labs/teammates/fsdev.config.mts"), /TEAMMATES_HARNESS[^\n]*harness:/],
  "the host's own default": [read("labs/teammates/host.mts"), /options\.harness \?\? "cursor"/],
  "Lead's prompt fallback": [read("labs/teammates/workforce/teams/teammates/workers/chief-of-staff/WORKER.md"), /When they name none, assign\s+it to `teammates\.cursor`/],
  "LEAD_FALLBACK_HARNESS": [read("labs/teammates/src/lib/harness.ts"), /const LEAD_FALLBACK_HARNESS = "cursor"/],
  "agent-flow harness setting": [read("labs/teammates/host.mts"), /settings: \{[^}]*harness: z\.string\(\)\.optional\(\)/],
  "Shift Manager's coder list": [read("packages/shift-manager/teams/devteam/host.mts"), /harnesses: Object\.fromEntries\(/],
  "Shift Manager's readiness list": [read("packages/shift-manager/teams/devteam/host.mts"), /\[harnesses\.slots\.harnesses\]: \[\.\.\.options\.harnessValues\]/],
  "the kit's coder switched off": [read("packages/shift-manager/teams/devteam/host.mts"), /\.without\(workforce\.slots\.workerFlows, "coder"\)/],
};
for (const [name, [src, re]] of Object.entries(tm)) if (!re.test(src)) problems.push(`NOT FOUND on this tree: ${name}`);

// The old phase values a run's key ends in today, which the spec's legacy-key table names.
// Renaming a mode changes its key only where its value changes; each must still be found.
const legacy = {
  "run key is <epic>/<issue>/<segment>": [read("packages/harness-manager/src/run-record.ts"), /return `\$\{epic\}\/\$\{issue\}\/\$\{phase\}`;/],
  "board task id uses the same segment": [read("packages/harness-manager/src/workspace.ts"), /joinIdentity\(assertSafeSegment\("issue", issue\), assertSafeSegment\("phase", phase\)\)/],
  "kit default's old value is code": [kit, /const PHASE: PhaseSpec = \{\s*phase: "code",/],
  "implement's old value is implement": [read("packages/shift-manager/teams/devteam/phase.mts"), /export const PHASE = "implement";/],
  "answer's old value is answer": [read("packages/shift-manager/teams/devteam/phase.mts"), /export const ANSWER_PHASE = "answer";/],
};
for (const [name, [src, re]] of Object.entries(legacy)) if (!re.test(src)) problems.push(`LEGACY KEY NOT AS THE SPEC SAYS: ${name}`);

const count = (c) => Object.entries(MAP).filter(([k, [v]]) => v === c && found.includes(k)).length;
console.log(`fork pieces: ${found.length} · HAS ${count("HAS")} · GAINS ${count("GAINS")} · DROP ${count("DROP")}`);
console.log(`teammates and shift-manager sites checked: ${Object.keys(tm).length}`);
console.log(`legacy-key facts checked: ${Object.keys(legacy).length}`);
for (const [k, [c, why]] of Object.entries(MAP)) if (found.includes(k)) console.log(`  ${c.padEnd(5)} ${k.padEnd(28)} ${why}`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
