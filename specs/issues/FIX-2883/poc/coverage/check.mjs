#!/usr/bin/env node
/**
 * Coverage check for the FIX-2883 closure spec. Retained design evidence, not production code.
 *
 * Re-derives the facts the spec's coverage matrix rests on, from the specs and code on disk:
 *   1. every child signal a closure row cites exists in that spec's Signal row;
 *   2. totality: every signal of the epic and of each child spec is rolled up by at least one row;
 *   3. every promise a row cites (an epic or child promise no child signal names) is in that spec, verbatim;
 *   4. every control credited to a child spec is named there, and no closure-owned control reuses a child's name;
 *   5. every "red on main" fact is in the base commit's file.
 *
 * Run from the repo root:  node specs/issues/FIX-2883/poc/coverage/check.mjs
 * Negative control:        node specs/issues/FIX-2883/poc/coverage/check.mjs --control   (must FAIL)
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cov = JSON.parse(readFileSync(join(here, "coverage.json"), "utf8"));
const control = process.argv.includes("--control");
if (control) {
  // Plant what each check must reject: a signal no spec has, a child signal no row rolls up
  // (a6 is the only row for FIX-2879 Refused), a reused control name, and a red-state line no file has.
  cov.rows = cov.rows.filter((r) => r.id !== "a6");
  cov.rows.push({ id: "zz", leg: "a", rollsUp: [["FIX-2878", "Teleport"]], controls: [["worker-only", "closure"]] });
  cov.redOnMain.push(["packages/harness-manager/src/run-record.ts", "frozenHarness: planted"]);
}

const norm = (s) => s.replace(/\s+/g, " ");
const text = Object.fromEntries(
  Object.entries(cov.specs).map(([id, files]) => [id, files.map((f) => readFileSync(f, "utf8")).join("\n")]),
);
const signalsOf = (id) => {
  const row = readFileSync(cov.specs[id][0], "utf8").split("\n").find((l) => l.startsWith("| **Signal** |"));
  if (!row) throw new Error(`${id}: no Signal row`);
  return new Set([...row.matchAll(/\*\*([A-Za-z][A-Za-z -]*?):\*\*/g)].map((m) => m[1]));
};
const signals = Object.fromEntries(Object.keys(cov.specs).map((id) => [id, signalsOf(id)]));

const failures = [];
const rolled = new Set();
const closureControls = new Set();
for (const row of cov.rows) {
  for (const [spec, sig] of row.rollsUp) {
    if (!signals[spec]?.has(sig)) failures.push(`${row.id}: ${spec} has no signal "${sig}"`);
    rolled.add(`${spec}:${sig}`);
  }
  for (const [spec, words] of row.promise ?? []) {
    if (!norm(text[spec]).includes(norm(words))) failures.push(`${row.id}: ${spec} does not say "${words}"`);
  }
  for (const [name, from] of row.controls) {
    if (from === "closure") closureControls.add(name);
    else if (!text[from].includes(`\`${name}\``) && !text[from].includes(`GOAL_CONTROL=${name}`))
      failures.push(`${row.id}: ${from} names no control "${name}"`);
  }
}
for (const name of closureControls) {
  for (const [id, t] of Object.entries(text)) {
    if (t.includes(`\`${name}\``) || t.includes(`GOAL_CONTROL=${name}`))
      failures.push(`closure control "${name}" reuses a name ${id} already gives a control`);
  }
}
for (const [id, set] of Object.entries(signals)) {
  for (const sig of set) if (!rolled.has(`${id}:${sig}`)) failures.push(`totality: ${id} signal "${sig}" is rolled up by no row`);
}
for (const s of cov.superseded) {
  if (!signals[s.spec]?.has(s.signal)) failures.push(`superseded: ${s.spec} has no signal "${s.signal}"`);
  if (!norm(text[s.spec]).includes(norm(s.was))) failures.push(`superseded: ${s.spec} does not say "${s.was}"`);
}
for (const [file, line] of cov.redOnMain) {
  let body = "";
  try { body = execFileSync("git", ["show", `${cov.base}:${file}`], { encoding: "utf8" }); } catch { /* missing file */ }
  if (!body.includes(line)) failures.push(`red on ${cov.base}: ${file} lacks "${line}"`);
}

const counts = Object.entries(signals).map(([id, s]) => `${id} ${s.size}`).join(", ");
if (failures.length) {
  console.log(`FAIL${control ? " (expected, --control)" : ""}\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `PASS — ${cov.rows.length} rows; signals rolled up: ${counts}; ` +
    `${cov.rows.filter((r) => r.promise).length} rows rest on a promise no child signal names in full ` +
    `(${cov.rows.filter((r) => r.promise && r.rollsUp.every(([s]) => s === "FIX-2876")).length} with no child signal at all); ` +
    `${closureControls.size} closure-owned controls; ${cov.superseded.length} superseded child signals; ` +
    `${cov.redOnMain.length} red-on-main facts at ${cov.base}`,
);
