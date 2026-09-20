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
 * TOTALITY, not a spot check — and stated at the width it actually proves.
 * The load-bearing assertion is not "these four tools are classified correctly"
 * — it is that EVERY tool-shaped `name:` literal the scan finds in SCAN_ROOTS
 * falls into a named class. A census that only checks the rows it already knows
 * about cannot surface the row that breaks the claim.
 *
 * WHAT THE SCAN DOES NOT SEE, stated so the next reader can see what would
 * break it. The scan matches `name: "identifier"` and cannot match a hyphen, so
 * it rests on a convention this repo follows but does not enforce: model-facing
 * tools are camelCase, while kebab-case `name:` values are BLOCK names. Those
 * are correctly excluded — a block is not a door. `channel-read`
 * (`packages/workforce/src/channel/channel-flow.ts`) and
 * `apply-skill-activation`
 * (`packages/orchestration/src/skills/apply-skill-activation.ts`) are both
 * `handler({...})`, and they reach a model only under camelCase action keys
 * (`read`, `fileTask`, `readBoard`). Checked at review: SCAN_ROOTS contains no
 * quoted kebab-case object key, so no model-facing tool there carries a
 * kebab-case name. If that convention ever breaks — a tool registered under a
 * hyphenated name — this scan would not see it and the claim would need the
 * registration site S2 defines, not a regex.
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

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
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
 *   work     — enumerates rows INSIDE a board the seat is already bound to.
 *              FIX-1482's surface, fenced out of this door's four domains: a
 *              work queue is not a catalog of what exists.
 */
const CLASSIFICATION = {
  // --- core/tools -----------------------------------------------------------
  listResources: "ungated",        // dumps instance.state for every collection; no llmReadable gate
  createResource: "act",
  readResource: "act",
  updateResource: "act",
  deleteResource: "act",
  // UNGATED, found in review. Its own header says a null pattern lists
  // everything, "Discovery only — no content is read, no `llmReadable` gate",
  // and `execute` calls `collectAllResources`, not `collectReadableResources`.
  // It was hand-labelled "content" here, which is how Claim 3a ever read as
  // "exactly one". Unlike `listResources` it HAS a caller
  // (`examples/knowledge-base/src/capability.ts`), so it is gated, not removed.
  globResources: "ungated",
  grepResourceContent: "content",
  searchResources: "content",
  readResourceContent: "content",
  writeResourceContent: "content",
  // --- orchestration --------------------------------------------------------
  loadSkill: "act",                // loads a skill the model already named
  runSkill: "act",
  skillInlineActivate: "act",
  taskTools: "act",
  // Constructed as `name: named("…")` — invisible until the scan learned that
  // form. `listTasks` is a real enumerator, board-scoped, and belongs to
  // FIX-1482 rather than to this door.
  addTask: "work",
  assignTask: "work",
  updateTask: "work",
  completeTask: "work",
  failTask: "work",
  blockTask: "work",
  cancelTask: "work",
  listTasks: "work",
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

/** Never part of the source tree being censused. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

function walk(dir, out = []) {
  let entries;
  try {
    // `withFileTypes` answers directory-or-file from the directory entry
    // itself, so nothing here ever resolves a path and nothing follows a link.
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // A symlink is never walked. pnpm's layout is a symlink farm, and a link
    // pointing at an ancestor makes the walk descend until the OS refuses with
    // ELOOP — which aborted this script before it printed any verdict, on
    // every checkout that had actually installed. A check that does not finish
    // is not evidence (BP-003), so the walk refuses links outright; the source
    // files these claims are about are real files, never links.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      out.push(join(dir, entry.name));
    }
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

/**
 * Both construction forms this repo uses for a model-facing tool name. The
 * literal form was the only one the scan knew, which silently hid the twelve
 * `name: named("…")` tools in `task-tools-capability.ts` — `listTasks`, a real
 * enumerator, among them. A scan that cannot see a construction form cannot
 * report the tool that breaks the claim.
 */
const NAME_FORMS = [
  /name:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /name:\s*named\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g,
];

/**
 * The negative control plants a real FILE inside a scan root, so the control
 * exercises the ENUMERATION and not just the assertion. The previous version
 * wrote straight into `found`, downstream of the regex — so it went red while
 * a genuinely unfindable tool stayed invisible, which is the exact failure the
 * control exists to catch, inside the control (BP-003).
 */
const PLANT_FILE = join(REPO, "packages/orchestration/src/__census_plant__.ts");

const found = new Map(); // name -> Set(relative file)
try {
  if (PLANT) {
    writeFileSync(
      PLANT_FILE,
      'export const planted = handler({ name: "plantedUnclassifiedTool" });\n',
    );
    console.log("  (--plant active: planted `__census_plant__.ts` into a scan root)\n");
  }
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(REPO, root))) {
      const src = readFileSync(file, "utf8");
      for (const re of NAME_FORMS) {
        for (const m of src.matchAll(re)) {
          const name = m[1];
          if (!found.has(name)) found.set(name, new Set());
          found.get(name).add(relative(REPO, file));
        }
      }
    }
  }
} finally {
  if (PLANT) rmSync(PLANT_FILE, { force: true });
}

const unclassified = [...found.keys()].filter((n) => !(n in CLASSIFICATION)).sort();
note(
  unclassified.length === 0,
  "TOTALITY · every tool-shaped `name:` found in SCAN_ROOTS is classified",
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
  ungated.length === 2 &&
    ["globResources", "listResources"].every((n) => ungated.includes(n)),
  "Claim 3a · the ungated enumerators are exactly listResources and globResources",
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
