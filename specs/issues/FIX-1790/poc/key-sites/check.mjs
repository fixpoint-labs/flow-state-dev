#!/usr/bin/env node
/**
 * FIX-1790 factual-base check: where does a user-scoped storage key come from,
 * and does each site have an organization in hand?
 *
 * The plan rests on one enumerated fact: every production read and write of
 * user-scoped storage takes its key from the derivation in
 * `packages/engine/src/stores/scope-keys.ts`, so putting the organization into
 * that derivation reaches every flow, with the exceptions the plan names. This
 * script re-derives the site list from the source instead of from memory. The
 * organization each site has in hand is recorded beside it (`org`), read by
 * hand from the code; the plan's surfaces follow from that column.
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
 * Totality, not a spot check: every file with a hit must appear in `SITES` with
 * the exact count of each family. A new file, or a new call in a listed file,
 * fails until someone classifies it.
 *
 * Negative control: `--plant` adds one synthetic source file carrying an
 * unclassified user-scope read. The check must FAIL on it.
 *
 * Retained design evidence. Not wired into CI or any default discovery. Run
 * from the repo root:
 *
 *   node specs/issues/FIX-1790/poc/key-sites/check.mjs
 *   node specs/issues/FIX-1790/poc/key-sites/check.mjs --plant   # must exit 1
 *
 * Adapted from FIX-1538's `poc/cell-sites/check.mjs`, which asked the same
 * question about the owner pin.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/**
 * Every file that derives or touches a user-scoped key.
 *
 *   convergence  — the derivation itself; the change lands here
 *   derives      — calls the derivation; `org` says where its organization comes from
 *   consumes     — stores a scopeId it was handed by a `derives` site
 *   session-only — variable scope argument, but only ever session or lineage
 *   harness      — test seeding helpers; since the build they seed through the derivation
 */
const SITES = {
  "packages/engine/src/stores/scope-keys.ts": {
    derive: 5, store: 0, class: "convergence", org: "a required argument; a missing or malformed one throws",
  },
  "packages/engine/src/context/createExecutionContext.ts": {
    derive: 4, store: 11, class: "derives", org: "the admitted run (options.orgId), equal to the session's",
  },
  "packages/engine/src/resources/internal.ts": {
    derive: 2, store: 4, class: "derives", org: "the stored session (session.orgId)",
  },
  "packages/engine/src/routes/state-routes.ts": {
    derive: 1, store: 1, class: "derives", org: "the stored session (session.orgId)",
  },
  "packages/scheduled/src/createResourceCollectionScheduleResolver.ts": {
    derive: 1, store: 1, class: "derives", org: "the dispatch id names it; the row must name the same org",
  },
  "packages/engine/src/context/resource-registry.ts": {
    derive: 0, store: 4, class: "consumes", org: "n/a, handed a derived id",
  },
  "packages/engine/src/routes/resource-routes.ts": {
    derive: 0, store: 10, class: "session-only", org: "n/a",
  },
  "packages/testing/src/runtime/createTestContext.ts": {
    derive: 0, store: 2, class: "harness", org: "options.orgId ?? DEFAULT_ORG_ID; seeds through userSeedCell",
  },
  "packages/testing/src/test-utilities/testFlow.ts": {
    derive: 0, store: 4, class: "harness", org: "the seeded org ?? DEFAULT_ORG_ID; seeds through userSeedCell",
  },
  "packages/testing/src/internal/user-cell.ts": {
    derive: 1, store: 0, class: "harness", org: "handed the run's org by both seeders",
  },
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

console.log(`scanned ${sources.length} source files; ${Object.keys(found).length} touch user-scoped keys`);
for (const [rel, site] of Object.entries(SITES)) {
  console.log(`  ${site.class.padEnd(12)} ${rel}\n               org: ${site.org}`);
}

if (problems.length > 0) {
  console.log("\nFAIL — the site inventory no longer matches the source:");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
console.log("\nPASS — every user-scoped key site is classified, and the counts match.");
