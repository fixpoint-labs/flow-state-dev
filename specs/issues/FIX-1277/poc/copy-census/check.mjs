#!/usr/bin/env node
// FIX-1277 spec evidence, retained with the spec. Default mode re-derives the
// spec's factual base: where the resource-store version-check rule is DEFINED,
// and whether the copies still agree. `--after` is the implementation's
// structural gate (PLAN V3): exactly one defining file, in contracts. It finds
// copies by name and by the guards' error text; it proves structure, not
// behaviour, and complements the conformance suite (V0/V2) and the SQL diff
// check (V6) rather than replacing them. Every non-test source file under
// packages/*/src is scanned (totality), so a copy nobody listed fails the run.
//
// Run from the repo root:
//   node specs/issues/FIX-1277/poc/copy-census/check.mjs            # today: 3 copies, bodies agree
//   node specs/issues/FIX-1277/poc/copy-census/check.mjs --after    # post-extract: exactly 1 definition, in contracts
// Negative control (plants an unlisted copy and a drifted body in memory; must report both):
//   node specs/issues/FIX-1277/poc/copy-census/check.mjs --control
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// role -> the names each copy uses for it
const ROLES = {
  versionNumber: ["assertVersionNumber"],
  setGuard: ["assertSetExpectedVersion"],
  deleteGuard: ["assertDeleteExpectedVersion"],
  conflict: ["resourceStateConflict", "conflictFrom"]
};
const BEFORE = [
  "packages/engine/src/stores/resource-state-predicate.ts",
  "packages/store-postgres/src/resource-state-store.ts",
  "packages/store-sqlite/src/resource-state-store.ts"
];
// The one documented, intentional difference: the engine copy deep-copies the
// conflict's currentValue (the in-memory adapter hands in its retained row).
const KNOWN = [[/cloneValue\((row\.state)\)/g, "$1"]];
// The guards' error text is pinned byte for byte (PLAN guardrails), so a
// renamed copy of a guard still carries it. `--after` counts the files that do.
const MESSAGES = [
  'must be a non-negative integer or "any"',
  'is not supported by ResourceStateStore.delete'
];

const mode = process.argv.includes("--after") ? "after" : "before";
const control = process.argv.includes("--control");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules" && e !== "dist") walk(p, out); }
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function corpus() {
  const files = {};
  for (const pkg of readdirSync("packages")) {
    const src = join("packages", pkg, "src");
    try { statSync(src); } catch { continue; }
    for (const f of walk(src)) files[f] = readFileSync(f, "utf8");
  }
  return files;
}

/** Body of the definition of `name` in `text`, comments stripped, whitespace collapsed. */
function body(text, name) {
  const def = new RegExp(`(?:function\\s+|const\\s+)${name}\\b`).exec(text);
  if (!def) return undefined;
  const open = text.slice(def.index).search(/\{\s*\n/) + def.index;
  let depth = 0, i = open;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) break;
  }
  return text.slice(open, i + 1)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function census(files) {
  const defs = {}; // file -> role -> body
  for (const [f, text] of Object.entries(files)) {
    for (const [role, names] of Object.entries(ROLES)) {
      for (const n of names) {
        const b = body(text, n);
        if (b !== undefined) (defs[f] ??= {})[role] = b;
      }
    }
  }
  return defs;
}

function check(files, expectMode) {
  const failures = [];
  const defs = census(files);
  const found = Object.keys(defs).sort();
  if (expectMode === "before") {
    for (const f of found) if (!BEFORE.includes(f)) failures.push(`unlisted definition: ${f}`);
    for (const f of BEFORE) if (!defs[f]) failures.push(`listed file defines nothing: ${f}`);
    for (const role of Object.keys(ROLES)) {
      const bodies = BEFORE.filter((f) => defs[f]?.[role]).map((f) => {
        let b = defs[f][role];
        for (const [re, to] of KNOWN) b = b.replace(re, to);
        return [f, b];
      });
      if (bodies.length !== BEFORE.length) failures.push(`${role}: defined in ${bodies.length}/${BEFORE.length} files`);
      const ref = bodies[0]?.[1];
      for (const [f, b] of bodies.slice(1)) if (b !== ref) failures.push(`${role}: ${f} drifts from ${bodies[0][0]}`);
    }
  } else {
    if (found.length !== 1 || !found[0].startsWith("packages/contracts/src/")) {
      failures.push(`expected exactly one defining file under packages/contracts/src, found: ${found.join(", ") || "none"}`);
    }
    const carriers = Object.keys(files).filter((f) => MESSAGES.some((m) => files[f].includes(m))).sort();
    if (carriers.length !== 1 || !carriers[0].startsWith("packages/contracts/src/")) {
      failures.push(`expected the guards' error text in exactly one file under packages/contracts/src, found: ${carriers.join(", ") || "none"}`);
    }
  }
  return { failures, found };
}

if (control) {
  const files = corpus();
  const sqlite = "packages/store-sqlite/src/resource-state-store.ts";
  files[sqlite] = files[sqlite].replace("(expectedVersion as number) < 0", "(expectedVersion as number) <= 0");
  files["packages/store-planted/src/copy.ts"] =
    "export function assertVersionNumber(v: unknown): void {\n  if (typeof v !== 'number') throw new TypeError('x');\n}\n";
  const { failures } = check(files, "before");
  const caughtPlant = failures.some((f) => f.includes("store-planted"));
  const caughtDrift = failures.some((f) => f.startsWith("versionNumber:") && f.includes("store-sqlite"));
  console.log(failures.map((f) => `  control reported: ${f}`).join("\n"));
  if (caughtPlant && caughtDrift) { console.log("CONTROL OK: planted copy and drifted body both reported"); process.exit(0); }
  console.log(`CONTROL FAILED: plant=${caughtPlant} drift=${caughtDrift}`); process.exit(1);
}

const { failures, found } = check(corpus(), mode);
console.log(`mode=${mode} defining files (${found.length}):\n${found.map((f) => `  ${f}`).join("\n")}`);
if (failures.length) { console.log(`FAIL\n${failures.map((f) => `  ${f}`).join("\n")}`); process.exit(1); }
console.log(mode === "before"
  ? "PASS: 3 defining files; all four roles agree across them (engine's conflict clone is the one known difference)"
  : "PASS: one definition, in contracts");
