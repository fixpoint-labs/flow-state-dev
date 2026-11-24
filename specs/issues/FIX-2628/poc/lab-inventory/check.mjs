#!/usr/bin/env node
// FIX-2628 spec POC. Retained design evidence, not production code: an .mjs file
// under specs/, outside every default test and build discovery.
/**
 * Re-derives the facts FIX-2628's spec rests on, from the files on disk:
 *
 * 1. Today's sizes: the adapter, the host, each file in `workforce/flows/`.
 * 2. The kit-only premise (FIX-2626 D1): the adapter is byte-equal to the
 *    commit FIX-2626's attribution read, that attribution still totals 42
 *    kit-only lines, and neither package the join spans depends on the other.
 * 3. The workforce surface the lab imports: every import of
 *    `@flow-state-dev/workforce*` in the lab and its goals, each identifier
 *    with one fate. Totality: an identifier with no fate, a fate nobody
 *    imports, or an import form the parser can't read stops the check.
 * 4. The project concept's other uses (flow names, settings, calls) by token.
 * 5. `workforce/flows/`: exactly the files the table names, each with its owner.
 *
 *   node specs/issues/FIX-2628/poc/lab-inventory/check.mjs                # the tables
 *   node specs/issues/FIX-2628/poc/lab-inventory/check.mjs --controls     # the red paths
 *   POC_EXPECT=gone node specs/issues/FIX-2628/poc/lab-inventory/check.mjs  # after FIX-2628: must pass then, fails on today's main
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const LAB = "labs/claude-code-style";
const GOALS = "goals/claude-code-style-lab";
const ADAPTER = `${LAB}/src/adapter.ts`;
const ATTRIBUTED_AT = "f0b34c529"; // the commit FIX-2626's attribution reads

/**
 * Each workforce identifier the lab or its goals import, to what happens to it.
 * - project:  workforce's project concept; leaves the lab with D1 (a repository is the workspace host's).
 * - install:  host wiring the workforce and harness kits take over (FIX-2627); the lab stops importing it.
 * - adapter:  goes with `adapter.ts`; screens use the kit packages' views and hooks instead.
 * - kept:     a package export the lab's renderer, tests or goals keep using.
 */
const FATES = {
  // adapter.ts
  createWorkforceClient: "adapter",
  delegateAnswerOf: "kept", // the renderer's reading of a delegate's answer line
  taskBriefOf: "kept",
  parseProjectRef: "project",
  projectRef: "project",
  WORK_PROJECT_STATE_KEY: "project",
  WORKER_ID_STATE_KEY: "adapter",
  // host.mts
  consultSessionsCapability: "install",
  createWorkerInstallation: "install",
  defineAgentWorkerFlow: "install",
  defineCoordinatorFlow: "install",
  hireWorkforce: "install",
  projectSourceCapability: "project",
  projectWorkspace: "project",
  readWorkforce: "install",
  // workforce/flows/projects.mts
  defineProjectBlocks: "project",
  RepositoryCheck: "project",
  // workforce/flows/harness-thread.mts (FIX-2627 merges it into the one coding worker flow)
  conversationLedgers: "install",
  filingConversationBoard: "install",
  messageReceivedEntry: "install",
  messageReceivedSchema: "install",
  projectChecks: "project",
  projectWorkspaceCapability: "project",
  startOwedSteerTurn: "install",
  steerTurnEntry: "install",
  workerConfigSchema: "install",
  workerMessagesResources: "install", // also a goal's stand-in mailbox, below
  workerTaskEntry: "install",
  MessageReceived: "install",
  WorkerInstallation: "install",
  // tests and goals
  delegateAnswerMetadata: "kept",
  taskBriefMetadata: "kept",
  MESSAGE_RECEIVED_ENTRY: "kept",
  WORKER_MESSAGES_RESOURCE: "kept",
  WorkerMessageResourceState: "kept",
};

/** Tokens of the project concept outside the import lines: flow names, settings, calls, words. */
const PROJECT_TOKENS = ["setWorkProject", "needsProject", "listProjects", "createProject", "PROJECTS_FLOW", "LabProject", "projectId"];

/** `workforce/flows/` today: each file, who takes it out, and where it goes. */
const FLOW_FILES = {
  "pins.mts": "FIX-2624 deletes it: pins become a user resource declared in user-marks.mts",
  "dismissals.mts": "FIX-2624 deletes it: the same, for dismissals",
  "user-marks.mts": "the pins and dismissals user resources (FIX-2624); FIX-2627 moves it out, FIX-2628 moves it into the app kit",
  "harness-thread.mts": "FIX-2627: merged into the one coding worker flow",
  "projects.mts": "moved out before the claim pass (FIX-2627's PR); FIX-2628 replaces it with the app kit's repositories",
};

/** Rows whose file may already be gone: FIX-2624 deletes them, before or after this check runs. */
const MAY_BE_GONE = new Set(["pins.mts", "dismissals.mts"]);

/**
 * Mentions of the package that are not import lines, by file, each named. Today one test
 * mocks the workforce client the adapter builds; it goes with the adapter.
 */
const NON_IMPORT = {
  [`${LAB}/test/watch-on-notice.test.ts`]: { count: 2, fate: "adapter: a vi.mock of the client the adapter builds" },
};

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](@flow-state-dev\/workforce[^"']*)["']/g;
const ANY_WORKFORCE = /["'](@flow-state-dev\/workforce[^"']*)["']/g;

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(m?ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Read the lab and its goals into a map, so the controls can plant into a copy. */
function load() {
  const files = new Map();
  for (const rel of [...walk(LAB), ...walk(GOALS)]) files.set(rel, readFileSync(path.join(ROOT, rel), "utf8"));
  const flows = existsSync(path.join(ROOT, LAB, "workforce/flows")) ? readdirSync(path.join(ROOT, LAB, "workforce/flows")) : [];
  return { files, flows };
}

/** The checks over one snapshot. Returns { problems, report }. */
function check({ files, flows }, expect) {
  const problems = [];
  const seen = new Map(); // identifier -> files
  const byFate = { project: 0, install: 0, adapter: 0, kept: 0 };
  for (const [rel, text] of files) {
    const parsed = new Set();
    for (const m of text.matchAll(IMPORT)) {
      parsed.add(m.index);
      for (const raw of m[2].split(",")) {
        const name = raw.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (name === "") continue;
        // After the move the lab imports new kit pieces; only the project concept may not remain.
        if (!(name in FATES) && expect !== "gone") problems.push(`no fate: ${name} (${rel})`);
        if (!seen.has(name)) seen.set(name, new Set());
        seen.get(name).add(rel);
      }
    }
    // Totality: every mention of the package sits inside an import this parser read, or is named in NON_IMPORT.
    const loose = [];
    for (const m of text.matchAll(ANY_WORKFORCE)) {
      const owner = [...text.matchAll(IMPORT)].find((i) => m.index > i.index && m.index < i.index + i[0].length);
      if (owner === undefined) loose.push(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 1).replace(/\s+/g, " "));
    }
    const allowed = NON_IMPORT[rel]?.count ?? 0;
    if (expect === "gone" ? loose.length > allowed : loose.length !== allowed) problems.push(`unparsed workforce import: ${rel}: ${loose.join(" | ")}`);
  }
  for (const name of Object.keys(FATES)) if (!seen.has(name) && expect !== "gone") problems.push(`stale fate row: ${name} is imported nowhere`);
  for (const name of seen.keys()) if (name in FATES) byFate[FATES[name]] += 1;

  const tokens = {};
  for (const token of PROJECT_TOKENS) {
    let n = 0;
    for (const [rel, text] of files) if (rel.startsWith(`${LAB}/`) && !rel.startsWith(`${LAB}/test/`)) n += text.split(token).length - 1;
    tokens[token] = n;
  }

  for (const f of flows) if (!(f in FLOW_FILES)) problems.push(`unowned file in workforce/flows/: ${f}`);
  for (const f of Object.keys(FLOW_FILES)) if (!flows.includes(f) && !MAY_BE_GONE.has(f) && expect !== "gone") problems.push(`stale flow row: ${f} is not in workforce/flows/`);

  if (expect === "gone") {
    const projectImports = [...seen.keys()].filter((n) => FATES[n] === "project");
    if (projectImports.length > 0) problems.push(`expect gone: the lab still imports workforce's project concept: ${projectImports.join(", ")}`);
    const tokenUses = Object.entries(tokens).filter(([, n]) => n > 0);
    if (tokenUses.length > 0) problems.push(`expect gone: project tokens remain: ${tokenUses.map(([t, n]) => `${t} ${n}`).join(", ")}`);
    if (files.has(ADAPTER)) problems.push("expect gone: src/adapter.ts still exists");
    if (flows.length > 0) problems.push(`expect gone: workforce/flows/ still holds ${flows.join(", ")}`);
  }
  return { problems, report: { seen, byFate, tokens } };
}

function lines(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8").split("\n").length - 1;
}

function sizes() {
  const out = [];
  if (existsSync(path.join(ROOT, ADAPTER))) out.push([ADAPTER, lines(ADAPTER)]);
  out.push([`${LAB}/host.mts`, lines(`${LAB}/host.mts`)]);
  const dir = path.join(ROOT, LAB, "workforce/flows");
  if (existsSync(dir)) for (const f of readdirSync(dir)) out.push([`${LAB}/workforce/flows/${f}`, lines(`${LAB}/workforce/flows/${f}`)]);
  return out;
}

/** The kit-only premise: same adapter as FIX-2626 read, its total, and the two packages' dependencies. */
function kitPremise() {
  const then = execFileSync("git", ["show", `${ATTRIBUTED_AT}:${ADAPTER}`], { cwd: ROOT, encoding: "utf8" });
  const same = existsSync(path.join(ROOT, ADAPTER)) && readFileSync(path.join(ROOT, ADAPTER), "utf8") === then;
  const table = execFileSync("node", ["specs/issues/FIX-2626/poc/client-half/attribute.mjs"], { cwd: ROOT, encoding: "utf8" });
  const kit = Number(/kit\s+(\d+)/.exec(table)?.[1]);
  const deps = (pkg) => {
    const json = JSON.parse(readFileSync(path.join(ROOT, "packages", pkg, "package.json"), "utf8"));
    return Object.keys({ ...json.dependencies, ...json.peerDependencies });
  };
  const hmOnWf = deps("harness-manager").includes("@flow-state-dev/workforce");
  const wfOnHm = deps("workforce").includes("@flow-state-dev/harness-manager");
  return { same, kit, hmOnWf, wfOnHm };
}

function print({ report }) {
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  console.log(`claude-code-style at ${head}`);
  console.log("\nsizes today");
  for (const [rel, n] of sizes()) console.log(`  ${String(n).padStart(5)}  ${rel}`);
  const premise = kitPremise();
  console.log("\nkit-only premise (FIX-2626 D1)");
  console.log(`  adapter byte-equal to ${ATTRIBUTED_AT}: ${premise.same}`);
  console.log(`  FIX-2626 attribution, kit-only lines: ${premise.kit}`);
  console.log(`  harness-manager depends on workforce: ${premise.hmOnWf}; workforce on harness-manager: ${premise.wfOnHm}`);
  console.log("\nworkforce identifiers imported, by fate");
  for (const fate of ["project", "install", "adapter", "kept"]) {
    const names = [...report.seen.keys()].filter((n) => FATES[n] === fate);
    console.log(`  ${fate.padEnd(8)} ${String(names.length).padStart(2)}  ${names.join(", ")}`);
  }
  console.log("\nproject tokens outside imports (lab, tests excluded)");
  for (const [t, n] of Object.entries(report.tokens)) console.log(`  ${String(n).padStart(4)}  ${t}`);
  console.log("\nworkforce/flows/");
  for (const [f, owner] of Object.entries(FLOW_FILES)) console.log(`  ${f.padEnd(20)} ${owner}`);
  if (!premise.same || premise.kit !== 42 || premise.hmOnWf || premise.wfOnHm) {
    console.error("\nkit-only premise does not hold as FIX-2626 recorded it");
    process.exitCode = 1;
  }
}

function controls() {
  const base = load();
  if (check(base).problems.length > 0) throw new Error("controls need a clean base: run without --controls first");
  const plant = (mutate, label, expected) => {
    const copy = { files: new Map(base.files), flows: [...base.flows] };
    mutate(copy);
    const { problems } = check(copy);
    const hit = problems.find((p) => p.includes(expected));
    if (hit === undefined) throw new Error(`control ${label}: no problem names "${expected}" (got ${problems.length}), it must`);
    console.log(`control ${label}: fails as it must (${hit})`);
  };
  plant((c) => c.files.set(`${LAB}/src/planted.ts`, 'import { definePlanted } from "@flow-state-dev/workforce";\n'), "unknown identifier", "no fate: definePlanted");
  plant((c) => c.files.set(`${LAB}/src/planted.ts`, 'import * as wf from "@flow-state-dev/workforce";\n'), "namespace import", "unparsed workforce import");
  plant((c) => c.files.set(`${LAB}/src/planted.ts`, 'const wf = await import("@flow-state-dev/workforce");\n'), "dynamic import", "unparsed workforce import");
  plant((c) => c.flows.push("notes.mts"), "unowned flows file", "unowned file in workforce/flows/: notes.mts");
  plant((c) => c.files.delete(`${LAB}/workforce/flows/projects.mts`), "stale fate row", "stale fate row: defineProjectBlocks");
  const gone = check(base, "gone");
  if (gone.problems.length === 0) throw new Error("control expect-gone: today's main passed POC_EXPECT=gone, it must fail");
  console.log(`control expect-gone on today's main: fails as it must (${gone.problems.length} problems, first: ${gone.problems[0]})`);
  // The done state must be reachable: no adapter, no workforce/flows/, new kit imports and no project tokens.
  const after = { files: new Map([[`${LAB}/src/lab.ts`, 'import { workforce, useTasks } from "@flow-state-dev/workforce";\n']]), flows: [] };
  const done = check(after, "gone");
  if (done.problems.length > 0) throw new Error(`control expect-gone after-state: a correct after-state failed: ${done.problems.join("; ")}`);
  console.log("control expect-gone after-state: passes as it must (new kit imports allowed)");
}

if (process.argv.includes("--controls")) {
  controls();
} else {
  const expect = process.env.POC_EXPECT;
  const snapshot = load();
  const result = check(snapshot, expect);
  if (expect !== "gone") print(result);
  if (result.problems.length > 0) {
    console.error(`\n${result.problems.length} problem(s):`);
    for (const p of result.problems) console.error(`  ${p}`);
    process.exitCode = 1;
  } else if (expect === "gone") console.log("expect gone: the lab imports no project concept, has no adapter and no workforce/flows/");
}
