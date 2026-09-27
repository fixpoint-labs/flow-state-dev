#!/usr/bin/env node
/**
 * FIX-1611 · inventory POC.
 *
 * Throwaway, retained as evidence. Not production code, not a workspace
 * package, outside default test, lint and knip discovery. Run it by hand; see
 * README.md.
 *
 * The claim it checks: PLAN.md's Inventory table names EVERY goal check and
 * e2e test that reads kitchen-sink's roster, and gives each one a re-pointed
 * target and a control. The inventory is a counted factual base, so it is
 * derived from the tree rather than trusted:
 *
 *   hits   goal directories (a `goal.md` two levels under `goals/`) any of whose
 *          files names a piece D7 or D8 cuts, or reads kitchen-sink's roster
 *          source; and every test in an `apps/kitchen-sink/e2e/*.spec.ts` file
 *          that names a cut piece
 *   rows   the rows of PLAN.md's "## Inventory" table
 *
 * It fails when a hit has no row (not total), a row names nothing on disk
 * (stale, unless it is marked as arriving with a sibling), or a row lacks a
 * disposition from the closed set or a control.
 *
 *   --drop N           negative control: drop the Nth row before matching
 *   --plant <dir>      negative control: add a synthetic goal hit
 *
 * Exit 0 when the table is total and every row is well formed.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const PLAN = join(ROOT, "specs/issues/FIX-1611/PLAN.md");

/** What D7 and D8 cut from kitchen-sink's roster and page. */
const CUT =
  /support\.(ada|grace|iris|otto|wren|mara|desk|ada-wren|noticeboard)\b|desk-clerk|followup-runner|desk-note|\bfollowups\b|hireSeat|Hire another|\bnoticeboard\b/;
/** A goal that reads kitchen-sink's roster wiring as source. */
const SOURCE = /apps\/kitchen-sink\/workforce|channel-notify|SEAT_ASKS|workforce-shell/;

/** The first bold word(s) of the "Re-pointed at" cell. */
const DISPOSITIONS = new Set([
  "real app",
  "fixture host",
  "real app + fixture host",
  "unchanged",
  "on arrival",
  "retires",
]);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

// --- hits ---------------------------------------------------------------

const goalHits = [];
for (const area of readdirSync(join(ROOT, "goals"))) {
  const areaDir = join(ROOT, "goals", area);
  if (!statSync(areaDir).isDirectory()) continue;
  for (const it of readdirSync(areaDir)) {
    const dir = join(areaDir, it);
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, "goal.md"))) continue;
    const text = walk(dir)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    if (CUT.test(text) || SOURCE.test(text)) goalHits.push(`${relative(ROOT, dir)}/`);
  }
}
const planted = flag("--plant");
if (planted) goalHits.push(planted.endsWith("/") ? planted : `${planted}/`);

const E2E = join(ROOT, "apps/kitchen-sink/e2e");
const e2eHits = [];
for (const name of readdirSync(E2E).filter((n) => n.endsWith(".spec.ts"))) {
  const text = readFileSync(join(E2E, name), "utf8");
  if (!CUT.test(text)) continue;
  for (const m of text.matchAll(/^\s*test\(\s*(["'`])((?:\\.|(?!\1).)*)\1/gm)) {
    e2eHits.push({ file: `e2e/${name}`, title: m[2] });
  }
}

// --- rows ---------------------------------------------------------------

const plan = readFileSync(PLAN, "utf8");
const section = plan.split(/^## Inventory\b/m)[1]?.split(/^## /m)[0];
if (!section) {
  console.error("PLAN.md has no ## Inventory section");
  process.exit(1);
}
let rows = section
  .split("\n")
  .filter((l) => l.startsWith("| ") && !/^\|\s*-/.test(l) && !/^\| Check \|/.test(l))
  .map((line) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const [check, , target = "", control = ""] = cells;
    const path = /`([^`]+)`/.exec(check)?.[1] ?? "";
    const title = /› "([^"]+)"/.exec(check)?.[1];
    const disposition = /^\*\*([^*]+)\*\*/.exec(target)?.[1];
    return { line, path, title, disposition, control };
  });
const drop = flag("--drop");
if (drop !== undefined) rows = rows.filter((_, i) => i !== Number(drop));

// --- match --------------------------------------------------------------

const problems = [];
const used = new Set();

for (const hit of goalHits) {
  const i = rows.findIndex((r) => r.path === hit);
  if (i === -1) problems.push(`MISSING  goal ${hit}`);
  else used.add(i);
}
for (const hit of e2eHits) {
  const i = rows.findIndex((r) => r.path === hit.file && r.title !== undefined && hit.title.startsWith(r.title));
  if (i === -1) problems.push(`MISSING  ${hit.file} › "${hit.title}"`);
  else used.add(i);
}
rows.forEach((r, i) => {
  if (!r.disposition || !DISPOSITIONS.has(r.disposition))
    problems.push(`BAD DISPOSITION  ${r.path} ${r.title ?? ""}: "${r.disposition ?? "(none)"}"`);
  if (r.control.length === 0) problems.push(`NO CONTROL  ${r.path} ${r.title ?? ""}`);
  if (!used.has(i) && r.disposition !== "on arrival")
    problems.push(`STALE  ${r.path} ${r.title ? `› "${r.title}"` : ""} matches nothing on disk`);
});

console.log(`goal hits: ${goalHits.length} · e2e test hits: ${e2eHits.length} · rows: ${rows.length}`);
for (const hit of goalHits) console.log(`  goal  ${hit}`);
for (const hit of e2eHits) console.log(`  e2e   ${hit.file} › ${hit.title.slice(0, 70)}`);
if (problems.length > 0) {
  console.log(`\nFAIL · ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS · the inventory is total and every row has a disposition and a control");
