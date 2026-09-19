#!/usr/bin/env node
/**
 * Re-derive the counted facts FIX-1394's spec rests on, from the repo.
 *
 * The spec argues from claims about the workforce file conventions and about
 * the grant gate. Each is a count, an enumeration, or a behaviour, and a
 * hand-derived one rots the moment someone lands an eighth convention or deletes
 * a test. So each is asserted here instead of asserted in prose.
 *
 * Run:  node spec/FIX-1394/evidence/check-conventions.mjs
 *       node spec/FIX-1394/evidence/check-conventions.mjs --negative-control
 *       node spec/FIX-1394/evidence/check-conventions.mjs --run-tests
 *
 * `--negative-control` plants an eighth convention reader, in a DIFFERENT door
 * from the one round 1 found missing, and asserts **C1 and C1-total** go RED. A
 * green check nobody has watched fail is not evidence (tenet 7).
 *
 * `--run-tests` executes the four behavioural suites C4 anchors on. Without it
 * C4 asserts only that those suites and their named cases still exist — which
 * catches a deleted or renamed test, but not a test that has stopped proving
 * what its name says. **Run it before the ratify**, not only at draft.
 *
 * ## What changed after round 1, and why it matters
 *
 * C4 used to grep for implementation identifiers (`registerCatalogTools: false`,
 * `toolSeatFence`). A reviewer pointed out that this proves an identifier is
 * present, not that the fence still works: the delegated-tool restriction could
 * stop applying while `toolSeatFence` is still spelled in the file, and the
 * capability-side fence lives in `core` and was not checked at all. That is
 * BP-003's "check aimed at a neighbour of the claim", and D1 rests on it. C4
 * now anchors on the behavioural suites that already exercise each tool source
 * against a restricted seat, rather than growing a second grant-gate
 * implementation inside this script.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const WORKFORCE = path.join(ROOT, "packages/workforce/src");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const failures = [];
const notes = [];

function assert(id, condition, detail) {
  if (condition) notes.push(`  PASS  ${id} — ${detail}`);
  else failures.push(`  FAIL  ${id} — ${detail}`);
}

// ---------------------------------------------------------------------------
// C1 · How many author-written convention surfaces the workforce tree defines.
//
// The spec says SEVEN, across three doors, and names them. Round 1 caught this
// assertion scanning only Door A: it counted `CHANNEL.md` and missed
// `blocks/*.ts`, which the matrix's variant B treats as a package surface. A
// totality assertion that measures a different set than the experiment compares
// is not one, so it now covers every door.
// ---------------------------------------------------------------------------

/** Door A - the Markdown conventions, all sharing one frontmatter dialect. */
const DOOR_A = {
  "WORKER.md": "loader/read-workforce-directory.ts",
  "TEAM.md": "loader/read-teams-directory.ts",
  "CHANNEL.md": "loader/read-channels-directory.ts",
  "resources/*.md": "loader/read-resources-directory.ts",
  "SKILL.md": "loader/read-seat-skills.ts",
};

/** Doors B and C - the TypeScript module conventions. No frontmatter at all. */
const DOORS_BC = {
  "resources/*.ts": "codegen/discover-resource-modules.ts",
  "blocks/*.ts": "codegen/discover-seat-blocks.ts",
};

const EXPECTED_CONVENTIONS = { ...DOOR_A, ...DOORS_BC };

// `read-workforce.ts` is Door A's JOIN and `discover.ts` is the codegen join;
// neither walks a convention of its own. Everything else is one reader.
const JOINS = new Set(["read-workforce.ts", "discover.ts"]);

const readersIn = (dir, prefix) =>
  fs
    .readdirSync(path.join(WORKFORCE, dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".ts") && !JOINS.has(f))
    .map((f) => `${dir}/${f}`);

const conventionReaders = [
  ...readersIn("loader", "read-"),
  ...readersIn("codegen", "discover-"),
];

assert(
  "C1",
  conventionReaders.length === Object.keys(EXPECTED_CONVENTIONS).length,
  `${conventionReaders.length} convention readers across three doors, spec says ${Object.keys(EXPECTED_CONVENTIONS).length}: ${conventionReaders.join(", ")}`,
);

// Totality: every reader on disk, in EITHER door, is one the spec classified.
// A reader nobody listed is exactly what a spot check cannot report.
for (const file of conventionReaders) {
  const claimed = Object.values(EXPECTED_CONVENTIONS).some((q) => q === file);
  assert("C1-total", claimed, `${file} is classified by the spec`);
}

// ---------------------------------------------------------------------------
// C2 · Five of the seven conventions already share ONE frontmatter dialect.
//
// Load-bearing for the spec's framing: the collapse this issue explores is not
// about parsing. The syntax is already one; what differs is what a folder MEANS
// and how it attaches.
// ---------------------------------------------------------------------------

// Door A only: B and C read TypeScript modules and have no frontmatter to share.
// That split is the point - the syntax is common across five of seven surfaces,
// and common across none of the remaining two.
for (const file of Object.values(DOOR_A)) {
  const src = read(`packages/workforce/src/${file}`);
  const sharesDialect =
    src.includes("parseFrontmatterYaml") || src.includes("splitFrontmatter");
  assert("C2", sharesDialect, `${file} parses via the shared frontmatter dialect`);
}

for (const file of Object.values(DOORS_BC)) {
  const src = read(`packages/workforce/src/${file}`);
  assert(
    "C2-typescript",
    !src.includes("parseFrontmatterYaml") && !src.includes("splitFrontmatter"),
    `${file} reads TypeScript modules - outside the shared dialect, by construction`,
  );
}

assert(
  "C2-skill",
  read("packages/orchestration/src/skills/skill-md.ts").includes("../shared/frontmatter"),
  "SKILL.md's parser uses the same shared dialect the workforce readers do",
);

// ---------------------------------------------------------------------------
// C3 · What a package can already carry, and where the lazy restriction really
// applies.
//
// The draft of this spec overstated the restriction — it said a document has no
// opt-in mode anywhere. The refusal is narrower than that, and the refusal's own
// message names the way out. Asserted here in its true scope, because the wrong
// version of this claim is what made P3 an unpassable probe.
// ---------------------------------------------------------------------------

const defineFlow = read("packages/core/src/flow/defineFlow.ts");

// The refusal is scoped to a single resource declared at FLOW level...
assert(
  "C3-lazy-scope",
  defineFlow.includes("declared at flow level cannot be prefetchMode: 'lazy'"),
  "the lazy refusal names flow level specifically, not every declaration site",
);

// ...and the message itself names the block-level path as the remedy, so a
// per-block lazy single is supported. P3 must be satisfiable.
assert(
  "C3-lazy-remedy",
  defineFlow.includes("Declare it on the specific block that needs it"),
  "the refusal's own message points at block-level declaration — lazy IS available there",
);

// A skill folder carries supporting files alongside SKILL.md — at the TYPE
// level, which is all this check can see.
//
// It used to be worded "an opt-in unit can ship a document today", and that is
// false: the probe run in spec-poc/FIX-1394-probes shows those files are stored
// in the skills collection and never rendered into the holding seat's context,
// before activation or after. Only the delegation surface reads them. A source
// regex cannot tell the difference between a field existing and its contents
// arriving somewhere, so the claim is narrowed to the thing it does check.
// See RATIFY.md -> "Correction to BR-6 (approved spec)".
const skillTypes = read("packages/core/src/types/skill.ts");
assert(
  "C3-skill-files-type",
  skillTypes.includes("interface SkillFile") &&
    /interface InitialSkill[\s\S]{0,400}files\?: SkillFile\[\]/.test(skillTypes),
  "a skill CARRIES supporting files: `SkillFile` exists and `InitialSkill.files?` declares them. Whether they reach a seat's context is a runtime claim this check cannot make — they do not",
);

// The file-declared resources convention is still flow-level, which is the real
// (narrow) constraint the document probe has to work within.
assert(
  "C3-resource-convention",
  read("packages/workforce/src/manifest.ts").includes('REFUSED_PREFETCH_MODE = "lazy"'),
  "the file-declared resources convention refuses lazy — it installs at flow level",
);

// ---------------------------------------------------------------------------
// C4 · THE GRANT INVARIANT. Nothing grants a seat a tool except the seat's own
// `tools:` key.
//
// The single claim D1 turns on, enforced at FOUR independent points. Anchored
// on the behavioural suites that exercise each one against a restricted seat,
// not on the presence of an implementation identifier.
// ---------------------------------------------------------------------------

const GRANT_GATE_SUITES = [
  {
    id: "C4-skills",
    file: "packages/workforce/test/agent-worker-flow.test.ts",
    mustContain:
      "still keeps a seat that omits `tools:` from reaching the tool, even though the skill declares `allowed-tools: [board]`",
    proves: "a held skill's `allowed-tools` is validated and grants nothing",
  },
  {
    id: "C4-blocks",
    file: "packages/workforce/test/custom-tools-seat.test.ts",
    mustContain: "does NOT let a seat call a registered block its `tools:` never named",
    proves: "a seat's own `blocks/` folder registers a name without granting it",
  },
  {
    id: "C4-delegation",
    file: "packages/orchestration/test/skills/delegation-tool-seats.test.ts",
    mustContain: "narrows seats to `allowed-tools` when the skill declares one",
    proves: "a skill's delegated board workers are narrowed, not free of the fence",
  },
  {
    id: "C4-capability",
    file: "packages/core/test/generator-tools-fence.test.ts",
    mustContain: "`tools: []` + a static tool-bearing capability reaches the model with zero tools",
    proves: "a capability's catalog grant is dropped by the block's own `tools:` (FIX-1393)",
  },
];

for (const suite of GRANT_GATE_SUITES) {
  if (!exists(suite.file)) {
    assert(suite.id, false, `${suite.file} is missing — ${suite.proves} is no longer covered`);
    continue;
  }
  assert(
    suite.id,
    read(suite.file).includes(suite.mustContain),
    `${suite.file} still covers: ${suite.proves}`,
  );
}

// The fence deliberately does NOT hold back a capability's control tools. The
// spec says so (BR-7), so the inverse is asserted too — otherwise a reader
// could take C4-capability to mean nothing crosses.
assert(
  "C4-controls",
  exists("packages/core/test/generator-tools-fence.test.ts") &&
    read("packages/core/test/generator-tools-fence.test.ts").includes(
      "`tools: []` does NOT hold back a capability's control tool",
    ),
  "control tools crossing the fence is covered too — BR-7's inverse",
);

// ---------------------------------------------------------------------------
// --run-tests · actually execute the four suites.
// ---------------------------------------------------------------------------

if (process.argv.includes("--run-tests")) {
  const files = GRANT_GATE_SUITES.map((s) => s.file);
  console.log(`\nRunning the grant-gate suites:\n  ${files.join("\n  ")}\n`);
  try {
    execFileSync("pnpm", ["vitest", "run", ...files], { cwd: ROOT, stdio: "inherit" });
    notes.push("  PASS  C4-run — the four grant-gate suites pass");
  } catch {
    failures.push("  FAIL  C4-run — a grant-gate suite failed; D1's evidence does not hold");
  }
}

// ---------------------------------------------------------------------------
// Negative control — plant a violation, watch C1/C1-total go red, then remove.
// ---------------------------------------------------------------------------

if (process.argv.includes("--negative-control")) {
  const planted = path.join(WORKFORCE, "codegen/discover-planted-blocks.ts");
  fs.writeFileSync(planted, "// a convention reader with its own private parser\n");
  let wentRed = false;
  try {
    const after = [...readersIn("loader", "read-"), ...readersIn("codegen", "discover-")];
    const classified = after.every((f) =>
      Object.values(EXPECTED_CONVENTIONS).some((q) => q === f),
    );
    wentRed = !classified || after.length !== Object.keys(EXPECTED_CONVENTIONS).length;
  } finally {
    fs.unlinkSync(planted);
  }
  console.log(
    wentRed
      ? "NEGATIVE CONTROL: PASS — a planted eighth reader (Door C) is caught by C1 and C1-total."
      : "NEGATIVE CONTROL: FAIL — a planted eighth reader slipped through. The assertion is not total.",
  );
  if (!wentRed) process.exit(1);
}

// ---------------------------------------------------------------------------

console.log(notes.join("\n"));
if (failures.length > 0) {
  console.error("\n" + failures.join("\n"));
  console.error(`\n${failures.length} claim(s) in FIX-1394's spec no longer hold.`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} claims hold as of this commit.`);
if (!process.argv.includes("--run-tests")) {
  console.log("C4 checked suite presence only. Run with --run-tests before the ratify.");
}
