#!/usr/bin/env node
/**
 * FIX-1737 scope check: re-derives the spec's row counts from the audit.
 *
 * Reads `../../assets/GAPS.md` and `scope.json` (the one slice list) (the 2026-10-02 audit, copied unedited), takes
 * every gap row (an ID like F3 or K8; ✓ rows are matches, X rows are the
 * structure kept from v1), and asserts three things:
 *
 * 1. Totality: every gap row is classified exactly once, in SLICE or OUT, and
 *    nothing is classified that the audit doesn't have.
 * 2. Scope: the in-scope set is exactly the rows whose Needs is "—", minus the
 *    rows OUT names (fonts, which FIX-1736 owns; registry-only rows).
 * 3. No sibling-blocked row is in a slice.
 *
 * 4. PLAN.md's PR plan table lists exactly scope.json's rows per slice.
 *
 * `--plant` adds a synthetic "—" row nobody classified. The check must then
 * fail on totality: that is its negative control.
 *
 * Retained design evidence only: not production code, not run by CI.
 * Run: node specs/issues/FIX-1737/poc/scope/check.mjs [--plant]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, "../../assets/GAPS.md"), "utf8");

/** Slice membership: the one source, shared with PLAN.md's PR plan. */
const scope = JSON.parse(readFileSync(join(here, "scope.json"), "utf8"));
const SLICE = scope.slices;
const OUT_DRAWABLE = scope.outDrawable;

const rows = [];
for (const line of text.split("\n")) {
  const m = line.match(/^\| ([A-Z]\d+) \| /);
  if (!m) continue;
  const cells = line.trim().replace(/^\||\|$/g, "").split(" | ").map((c) => c.trim());
  rows.push({ id: cells[0], cls: cells[4], size: cells[5], needs: cells[6] });
}
if (process.argv.includes("--plant")) rows.push({ id: "Z1", cls: "look", size: "S", needs: "—" });

const gaps = rows.filter((r) => !r.id.startsWith("X"));
const kept = rows.filter((r) => r.id.startsWith("X"));
const drawable = gaps.filter((r) => r.needs.startsWith("—"));
const blocked = gaps.filter((r) => !r.needs.startsWith("—"));

const failures = [];
const where = new Map();
for (const [slice, ids] of Object.entries(SLICE)) {
  for (const id of ids) {
    if (where.has(id)) failures.push(`${id} is in two slices`);
    where.set(id, slice);
  }
}
for (const id of Object.keys(OUT_DRAWABLE)) {
  if (where.has(id)) failures.push(`${id} is both in a slice and out`);
  where.set(id, "out");
}
const audit = new Set(gaps.map((r) => r.id));
for (const id of where.keys()) if (!audit.has(id)) failures.push(`${id} is classified but not in the audit`);
for (const r of drawable) if (!where.has(r.id)) failures.push(`${r.id} has Needs "—" and is in no slice and not out`);
for (const r of blocked) if (where.has(r.id) && where.get(r.id) !== "out") failures.push(`${r.id} waits on "${r.needs}" but is in slice ${where.get(r.id)}`);

// PLAN.md's PR plan must restate scope.json, row for row.
const plan = readFileSync(join(here, "../../PLAN.md"), "utf8");
const expand = (tok) => {
  const m = tok.match(/^([A-Z])(\d+)–\1?(\d+)$/) ?? tok.match(/^([A-Z])(\d+)–[A-Z](\d+)$/);
  if (!m) return [tok];
  const out = [];
  for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(`${m[1]}${n}`);
  return out;
};
let planRows = 0;
for (const line of plan.split("\n")) {
  const m = line.match(/^\| ([A-D]) · [^|]+ \| ([^|]+) \| [^|]+ \|$/);
  if (!m) continue;
  planRows++;
  const cell = m[2].trim();
  const list = cell.slice(cell.lastIndexOf(". ") + 2).replace(/\([^)]*\)/g, "");
  const ids = list.split(",").map((t) => t.trim()).filter(Boolean).flatMap(expand);
  const want = [...(SLICE[m[1]] ?? [])].sort().join(",");
  if ([...ids].sort().join(",") !== want) failures.push(`PLAN.md slice ${m[1]} lists ${ids.join(",")}, scope.json has ${want}`);
}

if (planRows !== Object.keys(SLICE).length) failures.push(`PLAN.md's PR plan has ${planRows} slice rows, scope.json has ${Object.keys(SLICE).length}`);

const inScope = drawable.filter((r) => where.get(r.id) && where.get(r.id) !== "out");
const by = (list, key) => list.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});

console.log(`audit rows: ${rows.length} (gaps ${gaps.length}, kept from v1 ${kept.length})`);
console.log(`Needs "—": ${drawable.length} · waits on a sibling: ${blocked.length}`);
console.log(`in scope: ${inScope.length} · out though drawable: ${Object.keys(OUT_DRAWABLE).length}`);
console.log(`in scope by class: ${JSON.stringify(by(inScope, "cls"))} · by size: ${JSON.stringify(by(inScope, "size"))}`);
for (const [slice, ids] of Object.entries(SLICE)) console.log(`slice ${slice}: ${ids.length} rows`);

if (failures.length) {
  console.log(`FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS");
