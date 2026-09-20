/**
 * FIX-817 · Manifest surface census — the spec's factual base, re-derived.
 *
 * The spec claims three counted things about the repository as it stands:
 *
 *   1. Every domain the ticket names ALREADY has a reader that can enumerate it.
 *   2. NO domain has a scoped, on-demand, model-facing discovery door.
 *   3. Discovery that does reach a model today is either AMBIENT (stuffed into
 *      the prompt every step) or UNGATED (a full-state dump that ignores the
 *      readable gate) — and the ungated one has no caller in the repository.
 *
 * Those three are the whole argument for "this is a missing SHAPE, not a
 * missing capability" (SPEC.md, D1). A reviewer should not have to take them on
 * trust, and a hand-derived list cannot report the entry nobody wrote down. So
 * this walks the tree and asserts them.
 *
 * TOTALITY, not a spot check. The load-bearing assertion is not "these four
 * tools are classified correctly" — it is that EVERY model-facing tool found in
 * the scanned packages falls into a named class. A census that only checks the
 * rows it already knows about cannot surface the row that breaks the claim.
 *
 * NEGATIVE CONTROL. Run with `--plant` to inject a synthetic unclassified tool
 * into the scan. The totality assertion MUST fail. A green check nobody has
 * watched go red is not evidence (tenet 7).
 *
 * Throwaway retained evidence. Not a package, not imported by anything, not on
 * any build, lint or test path. Run it explicitly:
 *
 *   node specs/issues/FIX-817/poc/manifest-surface-census/census.mjs
 *   node specs/issues/FIX-817/poc/manifest-surface-census/census.mjs --plant
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = process.argv[2]?.startsWith("--") ? process.cwd() : process.argv[2] ?? process.cwd();
const PLANT = process.argv.includes("--plant");

/** Packages whose model-facing tool surface this census covers. */
const SCAN_ROOTS = [
  "packages/core/src/tools",
  "packages/orchestration/src",
  "packages/workforce/src",
];

/**
 * How each model-facing tool relates to discovery. Every tool the scan finds
 * must land in one of these, or the census fails.
 *
 *   door     — scoped, on-demand, returns a manifest of what is in scope.
 *              The thing FIX-817 is about. Expected to be EMPTY today.
 *   ungated  — enumerates, but ignores the readable/enabled gate, or returns
 *              full state rather than a planning contract.
 *   act      — acts on a thing the caller already names. Does not enumerate.
 *   content  — reads or writes the content of a thing already identified.
 *   control  — a knob or mode, not a discovery surface at all.
 */
const CLASSIFICATION = {
  // --- core/tools -----------------------------------------------------------
  listResources: "ungated",        // dumps instance.state for every collection; no llmReadable gate
  createResource: "act",
  readResource: "act",
  updateResource: "act",
  deleteResource: "act",
  globResources: "content",
  grepResourceContent: "content",
  searchResources: "content",
  readResourceContent: "content",
  writeResourceContent: "content",
  // --- orchestration --------------------------------------------------------
  loadSkill: "act",                // loads a skill the model already named
  runSkill: "act",
  skillInlineActivate: "act",
  taskTools: "act",
  // --- capability / preset names, not tools ---------------------------------
  skills: "control",
  workforce: "control",
  todos: "control",
  compact: "control",
  request: "control",
  ancestors: "control",
  recentTrajectory: "control",
  allCompleted: "control",
  declaredDepsOnly: "control",
  none: "control",
};

/** Per-domain readers the spec claims already exist (claim 1). */
const READERS = [
  ["skills", "packages/orchestration/src/skills/internal/list-enabled-skills.ts", "listEnabledSkills"],
  ["seats (declared)", "packages/workforce/src/loader/read-declared-roster.ts", "readDeclaredRoster"],
  ["seats (live)", "packages/workforce/src/inventory/collections.ts", "defineSeatInventoryCollection"],
  ["channels (live)", "packages/workforce/src/inventory/collections.ts", "defineChannelInventoryCollection"],
  ["resources", "packages/core/src/tools/resource-tools.ts", "collectReadableResources"],
];

/** Ambient catalog formatters the spec claims are today's skills discovery (claim 3). */
const AMBIENT = [
  ["packages/orchestration/src/skills/context-fn.ts", "buildSkillsCatalogContext"],
  ["packages/orchestration/src/skills/load-tool.ts", "buildLoadCatalogContext"],
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const failures = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

// ---------------------------------------------------------------------------
// Claim 1 — every domain already has a reader.
// ---------------------------------------------------------------------------
console.log("\n## Claim 1 · every domain the ticket names already has a reader\n");
for (const [domain, file, symbol] of READERS) {
  let found = false;
  try {
    found = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${symbol}\\b`).test(
      readFileSync(join(REPO, file), "utf8"),
    );
  } catch {
    found = false;
  }
  note(found, `reader exists · ${domain}`, `${symbol} in ${file}`);
}

// ---------------------------------------------------------------------------
// Claims 2 + 3 — the census. Totality is the load-bearing assertion.
// ---------------------------------------------------------------------------
console.log("\n## Claims 2 & 3 · classify every model-facing tool in the scanned packages\n");

const found = new Map(); // name -> Set(relative file)
for (const root of SCAN_ROOTS) {
  for (const file of walk(join(REPO, root))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/name:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      const name = m[1];
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(relative(REPO, file));
    }
  }
}

if (PLANT) {
  // Negative control: a tool the classification table has never heard of.
  // The totality assertion below MUST reject it.
  found.set("plantedUnclassifiedTool", new Set(["<planted by --plant>"]));
  console.log("  (--plant active: injected `plantedUnclassifiedTool`)\n");
}

const unclassified = [...found.keys()].filter((n) => !(n in CLASSIFICATION)).sort();
note(
  unclassified.length === 0,
  "TOTALITY · every model-facing tool found is classified",
  unclassified.length === 0
    ? `${found.size} tools, all classified`
    : `unclassified: ${unclassified.join(", ")}`,
);

const doors = [...found.keys()].filter((n) => CLASSIFICATION[n] === "door");
note(
  doors.length === 0,
  "Claim 2 · no scoped on-demand discovery door exists today",
  doors.length === 0 ? "0 doors" : `found: ${doors.join(", ")}`,
);

const ungated = [...found.keys()].filter((n) => CLASSIFICATION[n] === "ungated");
note(
  ungated.length === 1 && ungated[0] === "listResources",
  "Claim 3a · exactly one ungated enumerator, and it is listResources",
  `found: ${ungated.join(", ") || "none"}`,
);

// listResources ignores the gate its own module already defines.
const resourceTools = readFileSync(join(REPO, "packages/core/src/tools/resource-tools.ts"), "utf8");
const listBody = resourceTools.slice(resourceTools.indexOf("const listResourcesTool"));
const bodyToEnd = listBody.slice(0, listBody.indexOf("return {"));
note(
  bodyToEnd.includes("collectCollections(ctx)") && !bodyToEnd.includes("collectReadableResources"),
  "Claim 3b · listResources enumerates via collectCollections, bypassing the llmReadable gate",
  "collectReadableResources exists in the same module and is not used by it",
);

// ...and nothing in the repository calls it.
let callers = 0;
for (const root of ["packages", "apps"]) {
  for (const file of walk(join(REPO, root))) {
    const rel = relative(REPO, file);
    if (rel.includes("resource-tools.ts")) continue;
    if (/\bresourceTools\s*\(/.test(readFileSync(file, "utf8"))) callers += 1;
  }
}
note(callers === 0, "Claim 3c · resourceTools() has no caller in packages/ or apps/", `${callers} callers`);

console.log("\n## Claim 3d · skills discovery reaches the model ambiently\n");
for (const [file, symbol] of AMBIENT) {
  let found2 = false;
  try {
    found2 = new RegExp(`export\\s+function\\s+${symbol}\\b`).test(readFileSync(join(REPO, file), "utf8"));
  } catch {
    found2 = false;
  }
  note(found2, `ambient catalog formatter · ${symbol}`, file);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${failures.length === 0 ? "CENSUS GREEN" : `CENSUS RED — ${failures.length} failure(s)`}` +
    `${PLANT ? "  (expected RED under --plant)" : ""}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
