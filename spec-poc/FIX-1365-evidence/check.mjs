#!/usr/bin/env node
/**
 * FIX-1365 — the spec's factual base, re-derived rather than asserted.
 *
 * Part I §1 rests on three counted claims about what the goal corpus proves
 * today. Prose asserting them goes stale the moment a sibling lands a goal, and
 * this spec was written hours after six sibling PRs merged. So the claims are a
 * script:
 *
 *   C-A  No file under `goals/` references `defineAgentWorkerFlow` — the built-in
 *        kind's factory appears in no goal check at all.
 *   C-B  Every `hireWorkforce(` call site under `goals/` passes a `kinds`
 *        argument — so no goal hires the built-in the way an app would.
 *   C-C  Every `goals/workforce-*` goal declares a model-free `Model:` field —
 *        so no goal has ever run a model through a hired seat.
 *
 * TOTALITY, not a spot check: C-B and C-C enumerate from the filesystem and
 * assert over *every* hit found, so a goal nobody listed still has to satisfy
 * them. A checker that only verified the sites it already knew about could not
 * report the one that was added yesterday, which is the exact failure this
 * spec's research was at risk of.
 *
 * Run:  node spec-poc/FIX-1365-evidence/check.mjs
 * Control: PLANT=<a|b|c> node spec-poc/FIX-1365-evidence/check.mjs
 *          Writes a temporary file under goals/ that each claim MUST reject,
 *          then removes it. A green check nobody has watched go red is not
 *          evidence (tenet 7).
 *
 * Throwaway: lives on the never-merged spec branch, ships nowhere.
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const GOALS = join(REPO, "goals");

/** Every file under `goals/`, excluding node_modules. The enumeration is the point. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const plant = process.env.PLANT;
let planted;
if (plant) {
  const dir = join(GOALS, "_planted-control");
  mkdirSync(dir, { recursive: true });
  if (plant === "a") {
    planted = join(dir, "run.mts");
    writeFileSync(planted, 'import { defineAgentWorkerFlow } from "@flow-state-dev/workforce";\n');
  } else if (plant === "b") {
    planted = join(dir, "run.mts");
    writeFileSync(planted, "const seats = hireWorkforce(roster);\n");
  } else if (plant === "c") {
    mkdirSync(join(GOALS, "workforce-planted", "it-runs-a-model"), { recursive: true });
    planted = join(GOALS, "workforce-planted", "it-runs-a-model", "goal.md");
    writeFileSync(planted, "# planted\n\n**Model:** openai/gpt-5.4-mini\n");
  }
}

const files = walk(GOALS);
const failures = [];
const evidence = [];

// ---- C-A: the built-in's factory appears in no goal ------------------------
{
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("defineAgentWorkerFlow"));
  if (hits.length > 0) {
    failures.push(`C-A: defineAgentWorkerFlow appears in ${hits.length} goal file(s): ${hits.map((h) => relative(REPO, h)).join(", ")}`);
  } else {
    evidence.push(`C-A: defineAgentWorkerFlow appears in 0 of ${files.length} files under goals/`);
  }
}

// ---- C-B: every hireWorkforce call site passes `kinds` ---------------------
{
  const sites = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!f.endsWith(".mts") && !f.endsWith(".ts")) continue;
    // Each call expression, flattened enough to see its argument list.
    for (const m of text.matchAll(/hireWorkforce\s*\(([\s\S]{0,300}?)\)\s*;/g)) {
      sites.push({ file: relative(REPO, f), args: m[1].replace(/\s+/g, " ").trim() });
    }
  }
  if (sites.length === 0) failures.push("C-B: found no hireWorkforce call sites at all — the pattern stopped matching, which is a checker bug, not evidence");
  const bare = sites.filter((s) => !s.args.includes("kinds"));
  if (bare.length > 0) {
    failures.push(`C-B: ${bare.length} hireWorkforce call site(s) pass no kinds: ${bare.map((b) => `${b.file} → hireWorkforce(${b.args})`).join(" | ")}`);
  } else {
    evidence.push(`C-B: all ${sites.length} hireWorkforce call site(s) under goals/ pass a kinds argument`);
  }
}

// ---- C-C: every workforce goal is model-free -------------------------------
{
  const goalDocs = files.filter((f) => f.endsWith("goal.md") && /\/goals\/workforce-/.test(f));
  if (goalDocs.length === 0) failures.push("C-C: found no workforce goal.md files — checker bug, not evidence");
  const modelBacked = [];
  const unclassifiable = [];
  for (const f of goalDocs) {
    const text = readFileSync(f, "utf8");
    const m = text.match(/\*\*Model[:.]\*\*\s*([^\n]+)/);
    if (m === null) {
      // Not evidence of model-backing — evidence that `goal:all --model-free`
      // cannot classify this goal at all. goals/README requires the field be
      // present and machine-readable. Reported separately so the two never blur.
      unclassifiable.push(relative(REPO, f));
      continue;
    }
    const value = m[1].trim();
    if (!/^(n\/a|none)\b/i.test(value)) modelBacked.push(`${relative(REPO, f)} → ${value}`);
  }
  if (modelBacked.length > 0) {
    failures.push(`C-C: ${modelBacked.length} workforce goal(s) are model-backed: ${modelBacked.join(" | ")}`);
  } else {
    evidence.push(
      `C-C: 0 of ${goalDocs.length} workforce goal(s) are model-backed` +
        (unclassifiable.length > 0
          ? ` (${goalDocs.length - unclassifiable.length} declare a model-free Model field; ` +
            `${unclassifiable.length} carry NO machine-readable Model field at all, which goals/README requires: ${unclassifiable.join(", ")})`
          : "")
    );
  }
}

if (planted) {
  rmSync(join(GOALS, "_planted-control"), { recursive: true, force: true });
  rmSync(join(GOALS, "workforce-planted"), { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`FAIL${plant ? ` (planted control "${plant}" — this failure is the expected result)` : ""}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS${plant ? ` — PLANTED CONTROL "${plant}" WAS NOT CAUGHT; the claim is not actually checked` : ""}`);
for (const e of evidence) console.log(`  - ${e}`);
process.exit(plant ? 1 : 0);
