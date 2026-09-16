#!/usr/bin/env node
/**
 * FIX-1367 — the spec's factual base, re-derived rather than asserted.
 *
 * Every counted or enumerated claim in spec/FIX-1367 is checked here against
 * the tracked tree. Run it before publishing and after any review round that
 * touches a number:
 *
 *     node spec-poc/FIX-1367-admission/evidence.mjs
 *     node spec-poc/FIX-1367-admission/evidence.mjs --negative-control
 *
 * Throwaway. It lives under spec-poc/ (CI ignores it) and never merges.
 *
 * Two properties it is built for, both learned the hard way:
 *
 *  - **Totality, not spot checks.** F1 and F3 classify EVERY hit in the tracked
 *    tree and fail on the first one no rule claims. A checker that verifies the
 *    sites it already knows about cannot report the one nobody listed.
 *  - **A negative control that is actually run.** `--negative-control` plants
 *    an unclassified caller and an unclassified key hit, asserts both totality
 *    checks go RED, and removes them. A green check nobody has seen go red is
 *    not evidence (tenet 7).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEGATIVE_CONTROL = process.argv.includes("--negative-control");

/** Every tracked file, so "the tree" means the repo and not a directory someone remembered. */
function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.length > 0);
}

/** Every tracked file holding `needle`, with the matching line numbers. */
function hits(needle, files) {
  const found = [];
  for (const file of files) {
    if (!/\.(ts|tsx|mts|mjs|js|md)$/.test(file)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const lines = [];
    text.split("\n").forEach((line, i) => {
      if (line.includes(needle)) lines.push(i + 1);
    });
    if (lines.length > 0) found.push({ file, lines });
  }
  return found;
}

const results = [];
const record = (id, ok, claim, detail) => {
  results.push({ id, ok, claim, detail });
};

/**
 * Classify every hit, and fail on any the rules do not claim.
 *
 * `rules` is an ordered list of [label, predicate]; the first match wins. A hit
 * matching none is the failure this function exists to produce.
 */
function classifyAll(id, claim, found, rules) {
  const buckets = new Map(rules.map(([label]) => [label, []]));
  const unclassified = [];
  for (const hit of found) {
    const rule = rules.find(([, test]) => test(hit.file));
    if (rule === undefined) unclassified.push(hit.file);
    else buckets.get(rule[0]).push(hit.file);
  }
  const summary = [...buckets]
    .map(([label, files]) => `${label}=${files.length}`)
    .join(" ");
  record(
    id,
    unclassified.length === 0,
    claim,
    unclassified.length === 0
      ? `${found.length} file(s): ${summary}`
      : `UNCLASSIFIED: ${unclassified.join(", ")} (${summary})`
  );
  return buckets;
}

// ---------------------------------------------------------------------------
// The negative control, planted before anything is counted.
// ---------------------------------------------------------------------------

const PLANTED = [
  {
    file: "packages/engine/src/__evidence_control__.ts",
    body: "// planted by the FIX-1367 evidence negative control\nhireWorkforce([]);\nconst x = { seatSkills: [] };\nexport default x;\n"
  }
];

if (NEGATIVE_CONTROL) {
  for (const { file, body } of PLANTED) {
    fs.writeFileSync(path.join(ROOT, file), body);
    // Tracked, because every check reads `git ls-files` — an untracked plant
    // would be invisible and the control would pass for the wrong reason.
    execFileSync("git", ["add", "-N", file], { cwd: ROOT });
  }
}

const files = trackedFiles();

// ---------------------------------------------------------------------------
// F1 — who calls hireWorkforce
// ---------------------------------------------------------------------------
// Claim in the spec: the seat factory has no consumer outside its own package,
// so tightening admission has a blast radius of this package's tests and docs.

classifyAll(
  "F1",
  "every `hireWorkforce(` hit is this package's own source, tests, docs or a spec artifact",
  hits("hireWorkforce(", files),
  [
    ["workforce-src", (f) => f.startsWith("packages/workforce/src/")],
    ["workforce-test", (f) => f.startsWith("packages/workforce/test/")],
    ["workforce-docs", (f) => f.startsWith("packages/workforce/") && f.endsWith(".md")],
    // Found by this check's own totality assertion, not by the author: three
    // real-path goal checks hire a roster. They are the blast radius the spec
    // would otherwise have missed, and the family the non-agent Proof joins.
    ["goal-checks", (f) => f.startsWith("goals/workforce-seats/")],
    ["site-docs", (f) => f.startsWith("apps/docs/")],
    ["internal-docs", (f) => f.startsWith("docs/")],
    ["spec-artifacts", (f) => f.startsWith("spec/") || f.startsWith("spec-poc/")]
  ]
);

// The same three goals, counted on their own so the spec can cite the number.
const goalDirs = new Set(
  hits("hireWorkforce(", files)
    .filter((h) => h.file.startsWith("goals/workforce-seats/"))
    .map((h) => h.file.split("/").slice(0, 3).join("/"))
);
record(
  "F1b",
  goalDirs.size === 3,
  "exactly three goal checks under goals/workforce-seats/ hire a roster",
  [...goalDirs].map((d) => d.split("/")[2]).sort().join(", ")
);

// ---------------------------------------------------------------------------
// F2 — the conditional injection is a single site, and it is a probe
// ---------------------------------------------------------------------------
// Claim: `seatSkills` is handed over only when the kind's PROBED default config
// declares the key. One site, one guard. If this ever becomes two, the spec's
// "one thing to replace" framing is wrong.

const hireSrc = fs.readFileSync(path.join(ROOT, "packages/workforce/src/hire.ts"), "utf8");
const probeGuards = hireSrc.split("\n").filter((l) => l.includes("Object.hasOwn(declared, SEAT_SKILLS_KEY)"));
record(
  "F2",
  probeGuards.length === 1,
  "hire.ts guards the seatSkills hand-off with exactly one probe of the kind's default config",
  `${probeGuards.length} guard site(s)`
);

const nonEmptyGuard = hireSrc.includes("manifest.skills !== undefined && manifest.skills.length > 0");
record(
  "F2b",
  nonEmptyGuard,
  "the hand-off is additionally gated on a NON-EMPTY set (the second condition the spec removes)",
  nonEmptyGuard ? "present" : "ABSENT — the spec's description of today is stale"
);

// ---------------------------------------------------------------------------
// F3 — where the seatSkills name lives
// ---------------------------------------------------------------------------
// Claim: the key is a merged, published surface — src, tests, the package
// README, two site pages and one architecture doc — which is why the spec keeps
// the spelling rather than renaming it to `skills`.

classifyAll(
  "F3",
  "every `seatSkills` hit is classified as src, test, package docs, site docs, architecture or spec",
  hits("seatSkills", files),
  [
    ["workforce-src", (f) => f.startsWith("packages/workforce/src/")],
    ["workforce-test", (f) => f.startsWith("packages/workforce/test/")],
    ["package-docs", (f) => f.startsWith("packages/") && f.endsWith(".md")],
    ["site-docs", (f) => f.startsWith("apps/docs/")],
    ["goal-checks", (f) => f.startsWith("goals/")],
    ["architecture", (f) => f.startsWith("docs/")],
    ["spec-artifacts", (f) => f.startsWith("spec/") || f.startsWith("spec-poc/")]
  ]
);

// ---------------------------------------------------------------------------
// F4 — the framework closes the TOP-LEVEL config object only
// ---------------------------------------------------------------------------
// Claim: `closeConfigSchema` applies `.strict()` to the flow's own config
// object. A NESTED object inside it (the `params` placeholder) is left at zod's
// default, which strips. That is why the spec makes the placeholder's own
// closure a rule rather than assuming the framework supplies it.

const defineFlowSrc = fs.readFileSync(path.join(ROOT, "packages/core/src/flow/defineFlow.ts"), "utf8");
const strictOnTopLevel = /return \(schema as unknown as ZodObject<ZodRawShape>\)\.strict\(\);/.test(defineFlowSrc);
record(
  "F4",
  strictOnTopLevel,
  "closeConfigSchema closes the top-level config object with .strict() and recurses into nothing",
  strictOnTopLevel ? "single .strict() on the declared object" : "SHAPE CHANGED — re-read defineFlow.ts"
);

const catchallBlessing = defineFlowSrc.includes("move the open-ended data into one declared key whose");
record(
  "F4b",
  catchallBlessing,
  "the catchall refusal names the placeholder shape as the sanctioned alternative",
  catchallBlessing ? "wording present" : "wording ABSENT — D2's citation is stale"
);

// ---------------------------------------------------------------------------
// F5 — requiresConfig hides a kind's shape from the probe
// ---------------------------------------------------------------------------
// Claim: when a kind's schema cannot parse `{}`, its blueprint `config` falls
// back to the frozen empty object — so a hire-side pre-check cannot see that
// kind's keys at all. This is why the spec makes the pre-check a diagnostic and
// puts enforcement at the mint.

const fallsBackToEmpty = defineFlowSrc.includes("probe !== undefined && probe.success")
  && defineFlowSrc.includes(": EMPTY_FLOW_CONFIG");
record(
  "F5",
  fallsBackToEmpty,
  "a kind whose schema cannot parse {} exposes a blueprint config of {} — the probe is blind to it",
  fallsBackToEmpty ? "fallback present in defineFlow.ts" : "SHAPE CHANGED — D1's reasoning needs re-checking"
);

// ---------------------------------------------------------------------------
// F6 — the surface this issue adds does not exist yet
// ---------------------------------------------------------------------------

const existingSurface = hits("workerConfigSchema", files).filter(
  (h) => !h.file.startsWith("spec/") && !h.file.startsWith("spec-poc/")
);
record(
  "F6",
  existingSurface.length === 0,
  "no `workerConfigSchema` exists outside this spec — the thin contract is genuinely new surface",
  existingSurface.length === 0 ? "0 hits" : `FOUND: ${existingSurface.map((h) => h.file).join(", ")}`
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (NEGATIVE_CONTROL) {
  for (const { file } of PLANTED) {
    execFileSync("git", ["rm", "--cached", "--force", "--quiet", file], { cwd: ROOT });
    fs.rmSync(path.join(ROOT, file));
  }
}

const width = Math.max(...results.map((r) => r.claim.length));
for (const { id, ok, claim, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(4)} ${claim.padEnd(width)}  ${detail}`);
}

const failed = results.filter((r) => !r.ok);

if (NEGATIVE_CONTROL) {
  // The control is only meaningful if the TOTALITY checks are the ones that
  // broke. A run where something else failed proves nothing about them.
  const totalityFailed = failed.some((r) => r.id === "F1") && failed.some((r) => r.id === "F3");
  console.log(
    totalityFailed
      ? "\nNEGATIVE CONTROL OK — F1 and F3 both went red on a planted unclassified hit."
      : "\nNEGATIVE CONTROL FAILED — the planted hit did not turn the totality checks red."
  );
  process.exit(totalityFailed ? 0 : 1);
}

console.log(`\n${results.length - failed.length}/${results.length} claims hold.`);
process.exit(failed.length === 0 ? 0 : 1);
