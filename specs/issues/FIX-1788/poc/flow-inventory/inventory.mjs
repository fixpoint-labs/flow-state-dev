// FIX-1788 · flow inventory — retained spec evidence, not production code.
//
// Re-derives the factual base the spec rests on: which flows the repo's
// WORKER.md files name, how many files name each, and where each flow is
// defined. Every flow listed here becomes one shared copy under FIX-1788.
//
// Totality: every tracked WORKER.md outside specs/ is classified exactly once,
// checked against an independent count from `git ls-files`.
// Negative control: CONTROL=drop-one leaves one file unclassified, and the
// totality assertion must fail.
//
// Run: node specs/issues/FIX-1788/poc/flow-inventory/inventory.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = (pattern) =>
  execFileSync("git", ["ls-files", "--", pattern], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

// Retained specs are design evidence; their fixtures are not converted.
const inScope = (path) => !path.startsWith("specs/");

const workerFiles = tracked("**/WORKER.md").filter(inScope);
const sources = tracked("*.ts")
  .concat(tracked("*.mts"), tracked("*.tsx"))
  .filter(inScope)
  .filter((path) => !/\.(test|spec)\.tsx?$/.test(path));

// A file that names no flow runs on the built-in agent flow.
const DEFAULT_FLOW = "agent";

function flowOf(path) {
  const text = readFileSync(`${root}/${path}`, "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  const line = front?.[1].split("\n").find((l) => /^flow:\s*/.test(l));
  if (line === undefined) return DEFAULT_FLOW;
  return line.replace(/^flow:\s*/, "").replace(/^["']|["']$/g, "").trim();
}

const byFlow = new Map();
let classified = 0;
const files = process.env.CONTROL === "drop-one" ? workerFiles.slice(1) : workerFiles;
for (const path of files) {
  const flow = flowOf(path);
  if (!byFlow.has(flow)) byFlow.set(flow, []);
  byFlow.get(flow).push(path);
  classified += 1;
}

// Where a flow is defined: a source file declaring `kind: "<name>"`; a file
// under the convention `workforce/flows/workers/<name>.{ts,mts,tsx}`, whose
// basename is the flow's name; or, for the built-in, the AGENT_KIND constant.
const sourceText = new Map(sources.map((path) => [path, readFileSync(`${root}/${path}`, "utf8")]));
function definedIn(flow) {
  const quoted = new RegExp(`kind:\\s*["'\`]${flow.replace(/[-]/g, "\\-")}["'\`]`);
  const byConvention = new RegExp(`/flows/workers/${flow.replace(/[-]/g, "\\-")}\\.(ts|mts|tsx)$`);
  const byConstant = new RegExp(`[A-Z_]*KIND\\s*=\\s*["'\`]${flow.replace(/[-]/g, "\\-")}["'\`]`);
  const hits = [];
  for (const [path, text] of sourceText) {
    if (quoted.test(text) || byConstant.test(text) || byConvention.test(path)) hits.push(path);
  }
  if (flow === DEFAULT_FLOW) {
    for (const [path, text] of sourceText) {
      if (/export const AGENT_KIND = "agent"/.test(text)) hits.push(path);
    }
  }
  return hits;
}

const rows = [...byFlow.entries()]
  .map(([flow, paths]) => ({ flow, files: paths.length, defined: definedIn(flow), paths }))
  .sort((a, b) => b.files - a.files || a.flow.localeCompare(b.flow));

console.log(`WORKER.md files in scope: ${workerFiles.length} (specs/ excluded)`);
console.log(`Distinct flows named: ${rows.length}\n`);
console.log("| Flow | Files | Defined in |");
console.log("|---|---|---|");
for (const row of rows) {
  const where = row.defined.length === 0 ? "**no definition found**" : row.defined.slice(0, 3).join("<br>");
  const more = row.defined.length > 3 ? ` (+${row.defined.length - 3})` : "";
  console.log(`| \`${row.flow}\` | ${row.files} | ${where}${more} |`);
}

const undefinedFlows = rows.filter((row) => row.defined.length === 0);
if (undefinedFlows.length > 0) {
  console.log("\nFlows with no definition (each WORKER.md that names one):");
  for (const row of undefinedFlows) for (const path of row.paths) console.log(`  ${row.flow}: ${path}`);
}

// Totality: classified must equal the independent count.
if (classified !== workerFiles.length) {
  console.error(`\nFAIL · totality: classified ${classified} of ${workerFiles.length} WORKER.md files`);
  process.exit(1);
}
console.log(`\nPASS · totality: ${classified} of ${workerFiles.length} WORKER.md files classified`);
