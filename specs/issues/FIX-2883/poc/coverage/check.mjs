#!/usr/bin/env node
/**
 * Coverage check for the FIX-2883 closure spec. Retained design evidence, not production code.
 *
 * Re-derives the facts the spec's coverage matrix rests on, from the specs on disk:
 *   1. clauses: each spec's Signal row is split, mechanically, into signals (`**Name:**`) and each
 *      signal into clauses (at `;` and at a sentence end). A clause's key is `<spec>:<signal>#<n>`;
 *      `coverage.json → clauses` pins each key to the words it opens with, so a reworded spec fails;
 *   2. totality: every clause of the epic and of each child spec is covered by at least one row;
 *   3. every promise a row cites (an epic or child promise no child signal names) is in that spec, verbatim;
 *   4. every control credited to a child spec is named there, and no closure-owned control reuses a
 *      child's name;
 *   5. a red state per row: every row names at least one control that must turn it red. A row in a leg
 *      that drives an app over HTTP (a, c) may instead rely on `GOAL_COMMIT` on today's main
 *      (`"main": true`). Legs b and d cannot load on today's main, so they need a control. Code on the
 *      base commit is context in `contextOnMain`, and it is never counted as a red state.
 *
 * Run from the repo root:  node specs/issues/FIX-2883/poc/coverage/check.mjs
 * Negative control:        node specs/issues/FIX-2883/poc/coverage/check.mjs --control   (must FAIL)
 * Print the clause keys:   node specs/issues/FIX-2883/poc/coverage/check.mjs --clauses
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cov = JSON.parse(readFileSync(join(here, "coverage.json"), "utf8"));
const control = process.argv.includes("--control");
if (control) {
  // Plant what each check must reject: an uncovered clause (a6 alone covers FIX-2879 Refused#0),
  // a clause key no spec has, a d row with no control, a closure control reusing a child's name,
  // and a pinned clause whose spec words changed.
  cov.clauses["FIX-2878:Freeze#0"] = "after worker A's file changes";
  const a6 = cov.rows.find((r) => r.id === "a6");
  a6.covers = a6.covers.filter((k) => k !== "FIX-2879:Refused#0");
  cov.rows.push({ id: "zz", leg: "d", covers: ["FIX-2878:Teleport#0"], controls: [] });
  cov.rows.push({ id: "zy", leg: "b", covers: ["FIX-2878:Freeze#0"], controls: [["worker-only", "closure"]] });
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
/**
 * A spec source is a path on disk, or `git:<sha>:<path>` for a spec still on its review branch
 * (fetch that branch first). Once that spec merges, its entry goes back to a plain path.
 */
const readSpec = (src) =>
  src.startsWith("git:")
    ? execFileSync("git", ["show", src.slice(4)], { encoding: "utf8" })
    : readFileSync(src, "utf8");
const text = Object.fromEntries(
  Object.entries(cov.specs).map(([id, files]) => [id, files.map(readSpec).join("\n")]),
);

/** `<spec>:<signal>#<n>` → clause text, split mechanically from the spec's Signal row. */
function clausesOf(id, file) {
  const row = readSpec(file).split("\n").find((l) => l.startsWith("| **Signal** |"));
  if (!row) throw new Error(`${id}: no Signal row`);
  const parts = row.slice("| **Signal** |".length).replace(/\|\s*$/, "").split(/\*\*([A-Za-z][A-Za-z -]*?):\*\*/);
  const out = new Map();
  for (let i = 1; i < parts.length; i += 2) {
    parts[i + 1]
      .split(/;\s+|\.\s+(?=[A-Z*`(])/)
      .map((c) => norm(c).replace(/\.$/, ""))
      .filter(Boolean)
      .forEach((c, n) => out.set(`${id}:${parts[i]}#${n}`, c));
  }
  return out;
}
const clauses = new Map();
for (const [id, files] of Object.entries(cov.specs)) for (const [k, v] of clausesOf(id, files[0])) clauses.set(k, v);

if (process.argv.includes("--clauses")) {
  for (const [k, v] of clauses) console.log(`${k}  ${v}`);
  process.exit(0);
}

const failures = [];
for (const [key, opens] of Object.entries(cov.clauses)) {
  if (!clauses.has(key)) failures.push(`clause ${key}: not in its spec's Signal row`);
  else if (!clauses.get(key).startsWith(norm(opens))) failures.push(`clause ${key}: no longer opens "${opens}"`);
}
for (const key of clauses.keys()) if (!(key in cov.clauses)) failures.push(`clause ${key}: not pinned in coverage.json`);

const covered = new Set();
const closureControls = new Set();
for (const row of cov.rows) {
  for (const key of row.covers) {
    if (!clauses.has(key)) failures.push(`${row.id}: no clause ${key}`);
    covered.add(key);
  }
  for (const [spec, words] of row.promise ?? []) {
    if (!norm(text[spec]).includes(norm(words))) failures.push(`${row.id}: ${spec} does not say "${words}"`);
  }
  for (const [name, from] of row.controls) {
    if (from === "closure") closureControls.add(name);
    else if (!text[from].includes(`\`${name}\``) && !text[from].includes(`GOAL_CONTROL=${name}`))
      failures.push(`${row.id}: ${from} names no control "${name}"`);
  }
  const viaMain = row.main === true && (row.leg === "a" || row.leg === "c");
  if (row.controls.length === 0 && !viaMain) failures.push(`${row.id}: no control turns it red`);
}
for (const name of closureControls) {
  for (const [id, t] of Object.entries(text)) {
    if (t.includes(`\`${name}\``) || t.includes(`GOAL_CONTROL=${name}`))
      failures.push(`closure control "${name}" reuses a name ${id} already gives a control`);
  }
}
for (const key of clauses.keys()) if (!covered.has(key)) failures.push(`totality: ${key} is covered by no row`);
for (const s of cov.superseded) {
  for (const key of s.clauses) if (!clauses.has(key)) failures.push(`superseded: no clause ${key}`);
  if (!norm(text[s.spec]).includes(norm(s.was))) failures.push(`superseded: ${s.spec} does not say "${s.was}"`);
}

if (failures.length) {
  console.log(`FAIL${control ? " (expected, --control)" : ""}\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
const perSpec = Object.keys(cov.specs)
  .map((id) => `${id} ${[...clauses.keys()].filter((k) => k.startsWith(`${id}:`)).length}`)
  .join(", ");
console.log(
  `PASS — ${cov.rows.length} rows cover all ${clauses.size} clauses (${perSpec}); ` +
    `${cov.rows.filter((r) => r.promise).length} rows also rest on a promise no child clause names; ` +
    `every row has a red state (${cov.rows.filter((r) => r.controls.length > 0).length} by a named control, ` +
    `${cov.rows.filter((r) => r.controls.length === 0).length} by GOAL_COMMIT only); ` +
    `${closureControls.size} closure-owned controls; ${cov.superseded.length} superseded child assertions`,
);
