#!/usr/bin/env node
// Throwaway spec evidence (FIX-2576). Not production code.
//
// Lists every call of the scope-state fill in package source and says which
// schema each one passes. Today every call passes the flow's own
// `<scope>.stateSchema`; after FIX-2576 none may.
//
//   node specs/issues/FIX-2576/poc/read-sites/census.mjs            # report
//   node specs/issues/FIX-2576/poc/read-sites/census.mjs --after    # exit 1 on any direct pass
//   node specs/issues/FIX-2576/poc/read-sites/census.mjs --control  # plants a call; must be counted
//   node specs/issues/FIX-2576/poc/read-sites/census.mjs --control-totality  # plants an alias; exit 2
//
// Totality: every file under packages/*/src that mentions the fill is read,
// and a mention that is not an import, a comment, the definition, or a parsed
// call fails the run, so a call in a shape this script does not parse can't hide.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../../../../../", import.meta.url).pathname;
const FILL = "applyScopeStateDefaults";
const after = process.argv.includes("--after");
const control = process.argv.includes("--control");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const files = readdirSync(join(root, "packages"))
  .map((pkg) => join(root, "packages", pkg, "src"))
  .filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap((p) => walk(p));

const sources = files.map((f) => ({ file: relative(root, f), text: readFileSync(f, "utf8") }));
if (control) {
  sources.push({ file: "<planted>", text: `const x = ${FILL}(flow.session?.stateSchema, s);\n` });
}
// --control-totality plants a mention the parser can't read; the run must exit 2.
if (process.argv.includes("--control-totality")) {
  sources.push({ file: "<planted-alias>", text: `const fill = ${FILL};\n` });
}

const calls = [];
const unparsed = [];
for (const { file, text } of sources) {
  text.split("\n").forEach((line, i) => {
    if (!line.includes(FILL)) return;
    if (/^\s*(import|\*|\/\/|\/\*)/.test(line) || line.includes(`function ${FILL}`)) return;
    const m = line.match(new RegExp(`${FILL}\\(([^,]+),`));
    if (!m) {
      unparsed.push(`${file}:${i + 1}: ${line.trim()}`);
      return;
    }
    const arg = m[1].trim();
    calls.push({ at: `${file}:${i + 1}`, arg, direct: /\.(session|user|org)\??\.stateSchema$/.test(arg) });
  });
}

for (const c of calls) console.log(`${c.direct ? "DIRECT" : "merged"}  ${c.at}  ${c.arg}`);
const direct = calls.filter((c) => c.direct).length;
console.log(`\n${calls.length} calls, ${direct} pass the flow's own stateSchema directly`);
if (unparsed.length) {
  console.error(`unparsed mentions (totality failed):\n  ${unparsed.join("\n  ")}`);
  process.exit(2);
}
if (control && !calls.some((c) => c.at === "<planted>:1" && c.direct)) {
  console.error("control: the planted call was not counted");
  process.exit(3);
}
if (after && direct > 0) process.exit(1);
