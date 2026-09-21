/**
 * FIX-817 · Manifest surface census — the spec's factual base, re-derived.
 *
 * The spec claimed three counted things about the repository before the change:
 *
 *   1. Every domain the ticket names ALREADY has a reader that can enumerate it.
 *   2. NO domain has a scoped, on-demand, model-facing discovery door.
 *   3. Discovery that does reach a model is either AMBIENT (stuffed into the
 *      prompt every step) or UNGATED (an enumeration that ignores the readable
 *      gate) — and one of the two ungated ones has no caller in the repository.
 *
 * Those three are the whole argument for "this is a missing SHAPE, not a
 * missing capability" (SPEC.md, D1). A reviewer should not have to take them on
 * trust, and a hand-derived list cannot report the entry nobody wrote down. So
 * this walks the tree and asserts them.
 *
 * UPDATED AT S2/S3 (PLAN.md → V7). The claims this script gates are the
 * spec's factual base, and the change invalidates two of them by construction
 * — a gate that still asserts the pre-change world is not a gate. So the
 * counts are re-pointed at what the change is supposed to have done, and the
 * script stays the thing that would catch it if it hadn't:
 *
 *   - Claim 2 · doors go 0 → EXACTLY ONE. Not one per domain — that number is
 *     D1 stated arithmetically.
 *   - Claim 3a · ungated enumerators go 2 → ZERO, closed the two different
 *     ways the spec calls for (3b(i) and 3b(ii) name which way each).
 *   - Claim 1 and the totality assertion are unchanged, and still the point:
 *     the four readers must survive untouched, and every tool-shaped `name:`
 *     in the scanned roots must still fall into a named class.
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
  // Added at S2, with the module. `core`'s model-facing tool surface is these
  // two directories; a new one has to be listed here or the census stops
  // covering what it claims to cover. Deliberately not the whole of
  // `packages/core/src`: that pulls in ~25 block, preset and fixture `name:`
  // values, and a classification table padded with non-tools is a weaker
  // totality claim, not a stronger one.
  "packages/core/src/manifest",
  "packages/orchestration/src",
  "packages/workforce/src",
];

/**
 * How each model-facing tool relates to discovery. Every tool the scan finds
 * must land in one of these, or the census fails.
 *
 *   door     — scoped, on-demand, returns manifest entries for what is in
 *              scope. The thing FIX-817 builds. Exactly one after S2.
 *   ungated  — enumerates, but ignores the readable/enabled gate, or returns
 *              full state rather than a planning contract. Expected to be
 *              EMPTY after S3: both were closed there.
 *   gated    — enumerates paths, but only over what the caller may read.
 *   act      — acts on a thing the caller already names. Does not enumerate.
 *   content  — reads or writes the content of a thing already identified.
 *   control  — a knob or mode, not a discovery surface at all.
 *   work     — enumerates rows INSIDE a board the seat is already bound to.
 *              FIX-1482's surface, fenced out of this door's four domains: a
 *              work queue is not a catalog of what exists.
 */
const CLASSIFICATION = {
  // --- core/manifest --------------------------------------------------------
  // S2. The door the spec is about: scoped at its registry, on demand, and it
  // returns entries with purpose rather than stored state.
  discover: "door",
  // --- core/tools -----------------------------------------------------------
  // `listResources` was REMOVED at S3 — it dumped `instance.state` for every
  // collection with no `llmReadable` gate and had no caller. Its absence from
  // the scan is asserted below rather than classified here.
  createResource: "act",
  readResource: "act",
  updateResource: "act",
  deleteResource: "act",
  // Was the second ungated enumerator: its own header said a null pattern
  // listed everything with "no `llmReadable` gate", and `execute` called
  // `collectAllResources`. Unlike `listResources` it HAS a caller
  // (`examples/knowledge-base/src/capability.ts`), so S3 gated it rather than
  // removing it — it now enumerates `collectReadableResources`.
  globResources: "gated",
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

// The count this script exists to move. It read 0 while the spec was being
// written and reads 1 once S2 lands — one door for four domains, not one per
// domain, which is D1's claim stated as a number.
const doors = [...found.keys()].filter((n) => CLASSIFICATION[n] === "door");
note(
  doors.length === 1 && doors[0] === "discover",
  "Claim 2 · exactly one scoped on-demand discovery door exists (was 0)",
  `found: ${doors.join(", ") || "none"}`,
);

const ungated = [...found.keys()].filter((n) => CLASSIFICATION[n] === "ungated");
note(
  ungated.length === 0,
  "Claim 3a · no ungated enumerator remains (was listResources + globResources)",
  `found: ${ungated.join(", ") || "none"}`,
);

// Both leaks, closed the two different ways the spec calls for: the one with no
// caller is gone, the one with a live caller is gated. Read off the source, so
// a re-introduction under either name fails here rather than in review.
const resourceTools = readFileSync(join(REPO, "packages/core/src/tools/resource-tools.ts"), "utf8");
note(
  !/name:\s*"listResources"/.test(resourceTools),
  "Claim 3b(i) · listResources is gone from resourceTools()",
  "the ungated full-state enumerator the door replaces",
);

const searchTools = readFileSync(join(REPO, "packages/core/src/tools/resource-search-tools.ts"), "utf8");
const globBody = searchTools.slice(searchTools.indexOf('name: "globResources"'));
const globExec = globBody.slice(0, globBody.indexOf("const grepResourceContent"));
note(
  globExec.includes("collectReadableResources(ctx)") && !globExec.includes("collectAllResources"),
  "Claim 3b(ii) · globResources enumerates through the llmReadable gate",
  "a null pattern no longer lists collections nobody marked readable",
);

// The removal has to break nothing, which is only true while the factory has
// no caller anywhere. Re-derived rather than remembered.
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
