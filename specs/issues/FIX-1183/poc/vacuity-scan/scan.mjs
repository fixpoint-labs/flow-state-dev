#!/usr/bin/env node
/**
 * FIX-1183 vacuity scan — retained spec evidence, not production code.
 *
 * Re-derives the spec's inventory: every goal under goals/, the action the
 * spec proposes for it, and the code shapes that let an assertion pass over
 * zero evidence. It does not run any goal.
 *
 *   node specs/issues/FIX-1183/poc/vacuity-scan/scan.mjs            # scan + totals
 *   node specs/issues/FIX-1183/poc/vacuity-scan/scan.mjs --sites    # also list every flagged site
 *   node specs/issues/FIX-1183/poc/vacuity-scan/scan.mjs --control  # plant a blind goal; must FAIL
 *
 * Under --control the planted goal gets an inventory stub with no reason, so a
 * healthy scan fails on exactly one problem: "flagged but no reason" for the
 * planted goal, a blind site nobody read. If the scan stops flagging the planted
 * suppression shape, a second line says so.
 *
 * Exit 0: every goal is in inventory.json and every flagged goal carries a
 * reason. Exit 1: a goal is missing from the inventory (or an inventory entry
 * names no goal), or a flagged goal has no reason.
 *
 * The shapes are heuristics. A goal with no flag is not proven sound; a flag is
 * a site a person read. The spec says which sites were read and what they found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../..");
const GOALS = join(REPO, "goals");
const args = process.argv.slice(2);
const CONTROL = args.includes("--control");
const SITES = args.includes("--sites");

/** Directories under goals/ that are not goals. */
const SKIP = new Set(["node_modules", "lib", "scripts", "_template", "fixtures"]);

function discover(dir, found = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const child = join(dir, e.name);
    let isGoal = false;
    try { isGoal = statSync(join(child, "goal.md")).isFile(); } catch { isGoal = false; }
    if (isGoal) found.push(relative(GOALS, child));
    else discover(child, found);
  }
  return found;
}

function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "fixtures" || e.name === "node_modules") continue;
      sources(join(dir, e.name), out);
    } else if (/\.(mts|ts|mjs)$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

/**
 * A loop source that is a literal, a constant, or the fixture: never empty at run time.
 * POC-only: a per-goal allowlist tuned to today's goals. Do not copy it into the
 * production guard, which checks only the `suppress` shape and needs no allowlist.
 */
const FIXED = /^(\[|[A-Z_][A-Z0-9_]*\b|Object\.(entries|keys|values)\(\s*[A-Z_]|fixture\b|fx\b|expected\b|want\b|o\.seats|r\.notes|leg\.failures)/;
const PUSHES = /failures\.push|\bfail\(|\.fail\(|\bnote\(/;

/**
 * The shapes. Each returns true when a line (with the next few for context)
 * is an assertion that can pass while reading nothing.
 */
const SHAPES = {
  // `if (xs.length > 0 && !ok) failures.push(...)` — the issue's own example.
  suppress: (line, next) =>
    /\.length\s*(>|!==|>=)\s*[01]\s*&&/.test(line) && /^\s*(if|else if)\b|\bif\s*\(/.test(line) && PUSHES.test(line + next[0]),
  // `xs.every(...)` deciding a verdict with no floor on xs in the same file.
  every: (line, next, src) => {
    const m = /([A-Za-z_$][\w$]*)\.every\(/.exec(line);
    if (!m || /\bbreak\b|waitFor|readUntil|getAnimations/.test(line + next[0])) return false;
    if (/^[A-Z_]+$/.test(m[1]) || m[1] === "fixture") return false;
    const floor = new RegExp(`\\b${m[1]}\\.length\\s*(===|<|<=|!==)\\s*\\d|!${m[1]}\\.length\\b`);
    return PUSHES.test([line, ...next].join("\n")) && !floor.test(src);
  },
  // `if (x === undefined) continue;` inside a grading loop: the subject is skipped, silently.
  skip: (line, next, src, prev) =>
    /(===\s*undefined|===\s*null)\)\s*continue;/.test(line) && PUSHES.test(next.join("\n")) && !/sameSet|!==\s*JSON\.stringify|join\(\)\s*!==/.test(prev.join("\n")),
  // `for (const x of observed) { ... failures.push }` with no floor on `observed`.
  loop: (line, next, src) => {
    const m = /for\s*\(\s*const\s+(?:\[[^\]]*\]|\{[^}]*\}|\w+)\s+of\s+([^)]+?)\)\s*\{?\s*$/.exec(line);
    if (!m) return false;
    const it = m[1].trim();
    if (FIXED.test(it)) return false;
    if (!PUSHES.test(next.slice(0, 10).join("\n"))) return false;
    const head = /^([A-Za-z_$][\w$]*)/.exec(it)?.[1];
    if (head === undefined) return false;
    const floor = new RegExp(`\\b${head}(\\.\\w+)*\\.(length|size)\\s*(===|<|<=|!==)\\s*\\d|!${head}(\\.\\w+)*\\.length\\b|${head}\\.length\\s*===`);
    return !floor.test(src);
  },
};

function scan(id, files) {
  const hits = [];
  for (const [path, src] of files) {
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const next = lines.slice(i + 1, i + 13);
      const prev = lines.slice(Math.max(0, i - 8), i);
      for (const [name, test] of Object.entries(SHAPES)) {
        if (test(line, next, src, prev)) hits.push({ shape: name, at: `${path}:${i + 1}`, text: line.trim().slice(0, 140) });
      }
    });
  }
  return hits;
}

const inventory = JSON.parse(readFileSync(join(HERE, "inventory.json"), "utf8"));
const goals = discover(GOALS).sort();
const files = new Map(goals.map((id) => [id, sources(join(GOALS, id)).map((p) => [relative(GOALS, p), readFileSync(p, "utf8")])]));

if (CONTROL) {
  // A blind goal nobody inventoried, written in the issue's own shape.
  const planted = "control/planted-blind-goal";
  goals.push(planted);
  inventory[planted] = { action: "keep", why: "" }; // inventoried, never read: only its flagged site can fail
  files.set(planted, [[`${planted}/run.mts`, [
    "await runGoal(async (failures) => {",
    "  const values = items.map((i) => i.sequence).filter((v) => typeof v === \"number\");",
    "  const ok = values.every((v, i) => i === 0 || v >= values[i - 1]);",
    "  if (values.length > 0 && !ok) failures.push(\"ordering: not non-decreasing\");",
    "  return { failures, evidence: \"non-decreasing sequence\" };",
    "});",
  ].join("\n")]]);
}

const problems = [];
for (const id of goals) if (inventory[id] === undefined) problems.push(`not in inventory: ${id}`);
for (const id of Object.keys(inventory)) if (!goals.includes(id)) problems.push(`inventory names no goal: ${id}`);

const totals = {};
let flaggedGoals = 0;
let flaggedSites = 0;
for (const id of goals) {
  const hits = scan(id, files.get(id));
  const entry = inventory[id];
  if (hits.length > 0) {
    flaggedGoals += 1;
    flaggedSites += hits.length;
    if (entry !== undefined && (entry.why ?? "").trim() === "") problems.push(`flagged but no reason: ${id}`);
  }
  if (entry !== undefined) totals[entry.action] = (totals[entry.action] ?? 0) + 1;
  if (SITES && hits.length > 0) {
    console.log(`${id}  [${entry?.action ?? "NOT IN INVENTORY"}]`);
    for (const h of hits) console.log(`    ${h.shape.padEnd(8)} ${h.at}  ${h.text}`);
  }
  if (CONTROL && id.startsWith("control/")) {
    const shapes = new Set(hits.map((h) => h.shape));
    console.log(`control goal flagged: ${[...shapes].join(", ") || "nothing"}`);
    if (!shapes.has("suppress")) problems.push("control: the planted suppression shape was not flagged");
  }
}

console.log(`\n${goals.length} goals · ${flaggedGoals} with a flagged site · ${flaggedSites} flagged sites`);
console.log(Object.entries(totals).sort().map(([a, n]) => `${a}: ${n}`).join(" · "));
if (problems.length > 0) {
  console.error(`${CONTROL ? "FAIL (expected under --control)" : "FAIL"} —\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("PASS — every goal is inventoried, and every flagged goal carries a reason");
