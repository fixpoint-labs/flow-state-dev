#!/usr/bin/env node
/**
 * FIX-1737 scope check: re-derives the spec's row counts from the audit.
 *
 * Reads `../../assets/GAPS.md` (the 2026-10-02 audit, copied unedited), takes
 * every gap row (an ID like F3 or K8; ✓ rows are matches, X rows are the
 * structure kept from v1), and asserts three things:
 *
 * 1. Totality: every gap row is classified exactly once, in SLICE or OUT, and
 *    nothing is classified that the audit doesn't have.
 * 2. Scope: the in-scope set is exactly the rows whose Needs is "—", minus the
 *    rows OUT names (fonts, which FIX-1736 owns; registry-only rows).
 * 3. No sibling-blocked row is in a slice.
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

/** The spec's PR plan (PLAN.md → PR plan), by audit row. */
const SLICE = {
  A: ["F2", "F3", "F4", "F5", "F7", "F8", "F9", "W4", "C9", "W12"],
  B: ["F12", "F13", "F14", "F15", "F16", "F18", "F20", "F22", "C1", "C2", "C3", "C5", "C7", "C8", "C10"],
  C: ["W1", "W5", "W11", "T7", "T9", "T13", "P2", "P5", "P7", "P8"],
  D: ["I1", "I2", "I3", "I5", "I8", "I11", "I17", "I18", "K1", "K2", "K3", "K4", "K5", "K8", "K9", "R1", "R6", "R8"],
};

/** "—" rows this issue does not draw, with the owner. */
const OUT_DRAWABLE = {
  F1: "FIX-1736 (fonts)",
  T4: "registry part (message, reasoning and tool cards)",
  T6: "registry part (user message)",
};

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
