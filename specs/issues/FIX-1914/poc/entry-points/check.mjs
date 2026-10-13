#!/usr/bin/env node
/**
 * FIX-1914 · entry-points POC.
 *
 * Throwaway, retained as evidence. Not production code, not a workspace
 * package, outside default test, lint and knip discovery. Run it by hand; see
 * README.md.
 *
 * The claim it checks: PLAN.md's "Entry points" table names EVERY place a
 * browser test or goal opens Kitchen Sink's front page (`/`), which D1 turns
 * into the picker. Each of those has to open `/flow-state` instead, or it
 * lands on the picker and fails to find the shell.
 *
 *   files   every `apps/kitchen-sink/e2e/*.ts`, plus every `.mts` under
 *           `goals/` that serves Kitchen Sink (imports `lib/kitchen-sink.mts`,
 *           or is that file)
 *   opens   each `.goto(` in those files, classified by its target:
 *             root    `/`, `/?…`, `${origin}/`, `${origin}/${…}` (a query)
 *             other   any other path (`/devtool`)
 *           A `.goto(` that is neither fails the check (totality)
 *   rows    the files listed in PLAN.md's "## Entry points" table
 *
 * It fails when a file with a root open has no row, a row names a file with
 * no root open (stale), or a `.goto(` cannot be classified.
 *
 *   --after             post-implementation mode: a root open now FAILS,
 *                       because after D1 nothing should expect the shell at `/`
 *   --plant             negative control: add a synthetic unlisted root open
 *   --plant-unknown     negative control: add a synthetic unclassifiable open
 *
 * Exit 0 when the table is total and every open is classified.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const PLAN = join(ROOT, "specs/issues/FIX-1914/PLAN.md");
const args = new Set(process.argv.slice(2));

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name.startsWith(".")) continue;
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Files that open Kitchen Sink in a browser. */
const e2e = walk(join(ROOT, "apps/kitchen-sink/e2e")).filter((f) => f.endsWith(".ts"));
const goals = walk(join(ROOT, "goals"))
  .filter((f) => f.endsWith(".mts"))
  .filter((f) => f.endsWith("goals/lib/kitchen-sink.mts") || /lib\/kitchen-sink\.mts/.test(readFileSync(f, "utf8")));
const sources = [...e2e, ...goals].map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));

if (args.has("--plant")) sources.push({ file: "planted/unlisted.spec.ts", text: "await page.goto(`${origin}/`);\n" });
if (args.has("--plant-unknown")) sources.push({ file: "planted/unknown.spec.ts", text: "await page.goto(somewhere);\n" });

/** Classify one `.goto(` argument by its leading text. */
function classify(arg) {
  const a = arg.trim();
  // "/" or "/?..." as a plain string or a template literal
  if (/^["'`]\/(["'`?]|\$\{)/.test(a)) return "root";
  // `${origin}/` , `${x.origin}/${query}` , `${origin}/?…`
  if (/^`\$\{[\w.?]*origin\}\/(`|\?|\$\{)/.test(a)) return "root";
  if (/^["'`](\$\{[\w.?]*origin\})?\/[A-Za-z]/.test(a)) return "other";
  return "unknown";
}

const rootFiles = new Map();
const unknown = [];
let opens = 0;
for (const { file, text } of sources) {
  text.split("\n").forEach((line, i) => {
    const m = line.match(/\.goto\((.*)$/);
    if (!m) return;
    opens += 1;
    const kind = classify(m[1]);
    if (kind === "unknown") unknown.push(`${file}:${i + 1}: ${line.trim()}`);
    if (kind === "root") rootFiles.set(file, [...(rootFiles.get(file) ?? []), i + 1]);
  });
}

const plan = existsSync(PLAN) ? readFileSync(PLAN, "utf8") : "";
const section = plan.split(/^## Entry points\s*$/m)[1]?.split(/^## /m)[0] ?? "";
const rows = new Set([...section.matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]));

const failures = [];
for (const u of unknown) failures.push(`unclassified open: ${u}`);
if (args.has("--after")) {
  for (const [file, lines] of rootFiles) failures.push(`still opens the front page expecting the shell: ${file}:${lines.join(",")}`);
} else {
  for (const file of rootFiles.keys()) if (!rows.has(file)) failures.push(`root open with no PLAN row: ${file}`);
  for (const row of rows) if (!rootFiles.has(row)) failures.push(`stale PLAN row (no root open on disk): ${row}`);
}

console.log(`files scanned: ${sources.length} · .goto( calls: ${opens} · files opening /: ${rootFiles.size} · PLAN rows: ${rows.size}`);
for (const [file, lines] of rootFiles) console.log(`  root  ${file}:${lines.join(",")}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("PASS");
