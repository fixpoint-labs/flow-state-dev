#!/usr/bin/env node
/**
 * FIX-1538 factual-base check: where does a user-scoped storage key come from?
 *
 * The spec's premise is that the per-(org, user) cell is a narrow change: every
 * production read or write of user-scoped storage takes its key from the
 * derivation in `packages/engine/src/stores/scope-keys.ts`, with the flow in
 * hand, except for the bypasses the plan names. This script re-derives that
 * claim from the source instead of from a list someone wrote down.
 *
 * It scans every `packages/<pkg>/src/**\/*.ts` (tests excluded, and the store
 * adapters excluded, because they store what they are handed rather than
 * deriving a key) for two families of call:
 *
 *   derive — `resolveUserStorageKey(`, `resolveResourceScopeId(`, `resourceScopeIds(`
 *   store  — `stores.user.<get|set|delete|list>(`, and any `resourceState.*` /
 *            `content.*` call whose scope argument is not a literal
 *            `"session"`, `"org"` or `"lineage"`
 *
 * **Totality, not a spot check.** Every file with a hit must appear in `SITES`
 * with the exact count of each family and a class. A new file, or a new call in
 * a listed file, fails the check until someone classifies it. That is the
 * property that matters: a check that verifies the sites it knows about cannot
 * report the one nobody listed.
 *
 * **Negative control.** `--plant` adds one synthetic source file carrying an
 * unclassified user-scope read. The check must FAIL on it. Run it; a check you
 * have never seen go red is not evidence.
 *
 * Throwaway, retained as design evidence. Not wired into CI or any default
 * discovery. Run from the repo root:
 *
 *   node specs/issues/FIX-1538/poc/cell-sites/check.mjs
 *   node specs/issues/FIX-1538/poc/cell-sites/check.mjs --plant   # must exit 1
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/**
 * Every file that derives or touches a user-scoped key, and what it is.
 *
 *   convergence  — the derivation itself; the change lands here
 *   derives      — calls the derivation with the flow in hand; must pass the pin
 *   consumes     — stores a scopeId it was handed by a `derives` site
 *   session-only — variable scope argument, but only ever session or lineage
 *   bypass       — builds a user key without the derivation; named in PLAN.md
 *   harness      — test seeding helpers in `@flow-state-dev/testing`
 */
const SITES = {
  "packages/engine/src/stores/scope-keys.ts": { derive: 5, store: 0, class: "convergence" },
  "packages/engine/src/context/createExecutionContext.ts": { derive: 3, store: 11, class: "derives" },
  "packages/engine/src/resources/internal.ts": { derive: 2, store: 4, class: "derives" },
  "packages/engine/src/routes/state-routes.ts": { derive: 1, store: 1, class: "derives" },
  "packages/engine/src/context/resource-registry.ts": { derive: 0, store: 4, class: "consumes" },
  "packages/engine/src/routes/resource-routes.ts": { derive: 0, store: 10, class: "session-only" },
  "packages/scheduled/src/createResourceCollectionScheduleResolver.ts": { derive: 1, store: 1, class: "derives" },
  "packages/testing/src/runtime/createTestContext.ts": { derive: 0, store: 2, class: "harness" },
  "packages/testing/src/test-utilities/testFlow.ts": { derive: 0, store: 4, class: "harness" },
};

const DERIVE = /\b(resolveUserStorageKey|resolveResourceScopeId|resourceScopeIds)\(/g;
const STORE_USER = /\bstores\.user\.(get|set|delete|list)\(/g;
const STORE_SCOPED =
  /\b(resourceState|content)\.(get|getAll|getByPrefix|set|delete|deleteAll|purgeTombstones)\(\s*(?!"(session|org|lineage)")/g;

const EXCLUDED = [
  /\.test\.ts$/,
  /\/test\//,
  /^packages\/engine\/src\/stores\/(memory|filesystem)\//,
  /^packages\/store-(sqlite|postgres)\//,
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Drop comment lines so a doc comment quoting a call is not a call. */
function code(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

const files = [];
for (const pkg of readdirSync(join(ROOT, "packages"))) {
  const src = join(ROOT, "packages", pkg, "src");
  try {
    if (statSync(src).isDirectory()) walk(src, files);
  } catch {
    // a package with no src/ has nothing to classify
  }
}

const sources = files
  .map((path) => ({ rel: relative(ROOT, path), text: code(readFileSync(path, "utf8")) }))
  .filter(({ rel }) => !EXCLUDED.some((rule) => rule.test(rel)));

if (process.argv.includes("--plant")) {
  sources.push({
    rel: "packages/engine/src/routes/planted-negative-control.ts",
    text: 'const row = await ctx.stores.content.get("user", session.userId, key);',
  });
}

const found = {};
for (const { rel, text } of sources) {
  const derive = count(text, DERIVE);
  const store = count(text, STORE_USER) + count(text, STORE_SCOPED);
  if (derive + store > 0) found[rel] = { derive, store };
}

const problems = [];
for (const [rel, hit] of Object.entries(found)) {
  const want = SITES[rel];
  if (want === undefined) {
    problems.push(`UNCLASSIFIED ${rel}: derive=${hit.derive} store=${hit.store}`);
  } else if (want.derive !== hit.derive || want.store !== hit.store) {
    problems.push(
      `CHANGED ${rel}: expected derive=${want.derive} store=${want.store}, found derive=${hit.derive} store=${hit.store}`
    );
  }
}
for (const rel of Object.keys(SITES)) {
  if (found[rel] === undefined) problems.push(`GONE ${rel}: classified but has no hits`);
}

const byClass = {};
for (const [rel, site] of Object.entries(SITES)) (byClass[site.class] ??= []).push(rel);

console.log(`scanned ${sources.length} source files; ${Object.keys(found).length} touch user-scoped keys`);
for (const [cls, rels] of Object.entries(byClass)) console.log(`  ${cls}: ${rels.join(", ")}`);

if (problems.length > 0) {
  console.log("\nFAIL — the site inventory no longer matches the source:");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
console.log("\nPASS — every user-scoped key site is classified, and the counts match.");
