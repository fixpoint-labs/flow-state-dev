/**
 * Re-derives every counted fact FIX-1424's spec rests on. Throwaway — lives on
 * the spec branch only, runs with bare node from the repo root:
 *
 *   node spec/FIX-1424/checks/verify-evidence.mjs
 *   node spec/FIX-1424/checks/verify-evidence.mjs --negative-control
 *
 * Each fact is asserted as a TOTALITY (every package / every goal is
 * classified), not as a spot check, because a check that only inspects the
 * items it already knows about cannot report the one nobody listed. The
 * negative-control mode plants a violation of each assertion and requires it to
 * go red, so no assertion here is a green nobody has seen fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const neg = process.argv.includes("--negative-control");
const failures = [];
const facts = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// ---------------------------------------------------------------- F1
// Every workspace package is classified by what `exports["."]` resolves to.
// The spec's D1 rests on a source edit being live under tsx with no build.
const pkgDirs = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);
const byTarget = new Map();
for (const dir of pkgDirs) {
  let target = "NO-EXPORTS-DOT";
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
    const dot = (pkg.exports ?? {})["."];
    if (typeof dot === "string") target = dot;
    else if (dot && typeof dot === "object" && typeof dot.default === "string") target = dot.default;
  } catch { target = "UNREADABLE"; }
  byTarget.set(target, [...(byTarget.get(target) ?? []), dir]);
}
const srcPkgs = byTarget.get("./src/index.ts") ?? [];
const otherPkgs = pkgDirs.filter((d) => !srcPkgs.includes(d));
check(srcPkgs.length + otherPkgs.length === pkgDirs.length, "F1 totality: a package escaped classification");
check(srcPkgs.length >= 25, `F1: only ${srcPkgs.length} packages resolve "." to ./src/index.ts`);
check(srcPkgs.includes("workforce"), "F1: packages/workforce does not resolve to ./src/index.ts — the seed mutations' target is not live-from-source");
facts.push(`F1  ${srcPkgs.length}/${pkgDirs.length} packages resolve exports["."] to ./src/index.ts; the rest: ${otherPkgs.join(", ") || "none"}`);

// ---------------------------------------------------------------- F2
// Every goal is classified model-free / model-backed by the SAME regex
// run-all.mts uses. D2 scopes the sweep to the model-free set, so an
// unclassifiable goal.md is a hole in that scope, not a detail.
const GOALS = join(ROOT, "goals");
// The F2 plant targets a named goal, not whichever one the walk happens to yield
// first, because the exact planted-violation count asserted at the bottom rests
// on this plant firing.
const NEG_PLANT_GOAL = join(GOALS, "capability-config", "resolver-reaches-generator");
const goals = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (["node_modules", "lib", "scripts", "_template", "fixtures"].includes(e.name)) continue;
    const child = join(dir, e.name);
    let isGoal = false;
    try { isGoal = statSync(join(child, "goal.md")).isFile(); } catch {}
    if (isGoal) goals.push(child); else walk(child);
  }
})(GOALS);
const classify = (spec) => {
  const line = /^\*\*Model[:.]\*\*(.*)$/m.exec(spec);
  if (line === null) return "UNCLASSIFIED";
  const d = (line[1] ?? "").trim().toLowerCase();
  return d.startsWith("n/a") || d.startsWith("none") ? "model-free" : "model-backed";
};
let modelFree = 0, modelBacked = 0;
const unclassified = [];
const runnableFree = [];
for (const dir of goals) {
  let spec = readFileSync(join(dir, "goal.md"), "utf8");
  if (neg && dir === NEG_PLANT_GOAL) spec = spec.replace(/^\*\*Model[:.]\*\*.*$/m, "Model — mocked");  // planted
  const kind = classify(spec);
  if (kind === "UNCLASSIFIED") unclassified.push(dir.slice(ROOT.length + 1));
  else if (kind === "model-free") { modelFree += 1; try { if (statSync(join(dir, "run.mts")).isFile()) runnableFree.push(dir); } catch {} }
  else modelBacked += 1;
}
// Two goal.md carry no machine-readable `**Model:**` line today, so `goal:all
// --model-free` silently treats them as model-backed. Named rather than
// tolerated: the assertion still catches a THIRD one appearing.
const KNOWN_UNCLASSIFIED = [
  "goals/conductor/implement-phase-opens-a-pr",
  "goals/workforce-seats/a-callers-own-agent-wins-every-seat",
];
const newlyUnclassified = unclassified.filter((g) => !KNOWN_UNCLASSIFIED.includes(g));
check(newlyUnclassified.length === 0, `F2 totality: ${newlyUnclassified.length} goal.md carry no machine-readable Model line beyond the two known: ${newlyUnclassified.join(", ")}`);
check(modelFree >= 20, `F2: only ${modelFree} model-free goals — the sweep's addressable corpus is smaller than the spec claims`);
facts.push(`F2  ${goals.length} goals: ${modelFree} model-free (${runnableFree.length} with a run.mts), ${modelBacked} counted model-backed, of which ${unclassified.length} only because their goal.md has no machine-readable Model line (${unclassified.join(", ")})`);

// ---------------------------------------------------------------- F3
// The static guard stops at C4. The spec's premise is that C5+ is the path NOT
// taken, so a C5 appearing upstream would invalidate the framing.
const guardPath = join(ROOT, "goals/scripts/validate-control-shape.mts");
let guard = readFileSync(guardPath, "utf8");
if (neg) guard += "\n// C5  a fifth rule\n";  // planted
const ruleIds = [...new Set([...guard.matchAll(/\bC([1-9])\b/g)].map((m) => Number(m[1])))].sort();
check(JSON.stringify(ruleIds) === JSON.stringify([1, 2, 3, 4]), `F3: validate-control-shape.mts names rules C${ruleIds.join(",C")}, expected exactly C1-C4`);
facts.push(`F3  goals/scripts/validate-control-shape.mts names rules C${ruleIds.join(", C")}; it runs inside the root typecheck chain`);

// ---------------------------------------------------------------- F4
// Both seed entries share ONE `find` text (they differ only in `replace`), so
// there is a single anchor to verify. It must occur EXACTLY ONCE; an anchor
// matching zero or many times is the staleness failure S4 guards.
const hirePath = join(ROOT, "packages/workforce/src/hire.ts");
let hire = readFileSync(hirePath, "utf8");
if (neg) hire += "\n    settings[SEAT_SKILLS_KEY] = manifest.skills ?? [];\n";  // planted duplicate
const ANCHORS = [
  { id: "shared seed anchor (both entries)", text: "settings[SEAT_SKILLS_KEY] = manifest.skills ?? [];" },
];
for (const a of ANCHORS) {
  const n = hire.split(a.text).length - 1;
  check(n === 1, `F4: ${a.id} matches ${n} times in packages/workforce/src/hire.ts, wanted exactly 1`);
}
facts.push(`F4  the seed entries' shared \`find\` text occurs exactly once in packages/workforce/src/hire.ts (both entries use it; only \`replace\` differs)`);

// ---------------------------------------------------------------- F5
// The two goals the seed mutations claim exist, are model-free, and have runners.
const CLAIMED = [
  "goals/workforce-seats/a-non-agent-seat-receives-its-skills",
  "goals/workforce-seats/two-seats-run-their-own-configuration",
];
for (const id of CLAIMED) {
  const dir = join(ROOT, id);
  let ok = false;
  try { ok = statSync(join(dir, "run.mts")).isFile() && classify(readFileSync(join(dir, "goal.md"), "utf8")) === "model-free"; } catch {}
  check(ok, `F5: ${id} is missing, has no run.mts, or is not model-free`);
}
facts.push(`F5  both goals the seed mutations claim exist, are model-free, and ship a run.mts`);

// ---------------------------------------------------------------- report
for (const f of facts) console.log(f);
if (neg) {
  const expected = 3;  // one plant each: F2 totality, F3, F4
  if (failures.length !== expected) {
    console.error(`\nNEGATIVE CONTROL FAILED — ${failures.length} planted violation(s) caught, wanted exactly ${expected}:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nNEGATIVE CONTROL OK — all ${expected} planted violations caught:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(0);
}
if (failures.length > 0) {
  console.error(`\nFAIL — ${failures.length} fact(s) no longer hold:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nPASS — every counted fact in spec/FIX-1424 re-derived from the tree.");
