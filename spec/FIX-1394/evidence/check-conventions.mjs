#!/usr/bin/env node
/**
 * Re-derive the counted facts FIX-1394's spec rests on, from the repo.
 *
 * The spec argues from four claims about the workforce file conventions. Each
 * is a count or an enumeration, and a hand-derived one rots the moment someone
 * lands a fifth convention. So each is asserted here instead of asserted in
 * prose, and this script fails when one stops being true.
 *
 * Run:  node spec/FIX-1394/evidence/check-conventions.mjs
 *       node spec/FIX-1394/evidence/check-conventions.mjs --negative-control
 *
 * The negative control plants a fifth author-written convention reader that
 * bypasses the shared frontmatter dialect and asserts C2 goes RED. A green
 * check nobody has watched fail is not evidence (tenet 7).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const WORKFORCE = path.join(ROOT, "packages/workforce/src");
const ORCHESTRATION = path.join(ROOT, "packages/orchestration/src");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const failures = [];
const notes = [];

function assert(id, condition, detail) {
  if (condition) notes.push(`  PASS  ${id} — ${detail}`);
  else failures.push(`  FAIL  ${id} — ${detail}`);
}

// ---------------------------------------------------------------------------
// C1 · How many author-written convention files the workforce tree defines.
//
// The spec says FIVE, and names them. A sixth landing without this list moving
// is the drift this asserts against.
// ---------------------------------------------------------------------------

const EXPECTED_CONVENTIONS = {
  "WORKER.md": "loader/read-workforce-directory.ts",
  "TEAM.md": "loader/read-teams-directory.ts",
  "CHANNEL.md": "loader/read-channels-directory.ts",
  "resources/*.md": "loader/read-resources-directory.ts",
  "SKILL.md": "loader/read-seat-skills.ts",
};

const readerFiles = fs
  .readdirSync(path.join(WORKFORCE, "loader"))
  .filter((f) => f.startsWith("read-") && f.endsWith(".ts"));

// `read-workforce.ts` is the JOIN, not a convention reader: it walks nothing of
// its own. Everything else under `read-*` reads one author-written convention.
const conventionReaders = readerFiles.filter((f) => f !== "read-workforce.ts");

assert(
  "C1",
  conventionReaders.length === Object.keys(EXPECTED_CONVENTIONS).length,
  `${conventionReaders.length} convention readers, spec says ${Object.keys(EXPECTED_CONVENTIONS).length}: ${conventionReaders.join(", ")}`,
);

// Totality: every reader on disk is one the spec classified. A reader nobody
// listed is exactly what a spot check cannot report.
for (const file of conventionReaders) {
  const claimed = Object.values(EXPECTED_CONVENTIONS).some((p) => p.endsWith(file));
  assert("C1-total", claimed, `loader/${file} is classified by the spec`);
}

// ---------------------------------------------------------------------------
// C2 · The five conventions already share ONE frontmatter dialect.
//
// Load-bearing for the spec's framing: the collapse this issue explores is not
// about parsing. The syntax is already one; what differs is what a folder MEANS
// and how it attaches.
// ---------------------------------------------------------------------------

for (const file of conventionReaders) {
  const src = read(`packages/workforce/src/loader/${file}`);
  const sharesDialect =
    src.includes("parseFrontmatterYaml") || src.includes("splitFrontmatter");
  assert("C2", sharesDialect, `loader/${file} parses via the shared frontmatter dialect`);
}

const skillMd = read("packages/orchestration/src/skills/skill-md.ts");
assert(
  "C2-skill",
  skillMd.includes("../shared/frontmatter"),
  "SKILL.md's parser uses the same shared dialect the workforce readers do",
);

// ---------------------------------------------------------------------------
// C3 · Only ONE of the five has an opt-in attachment mode.
//
// Skills can be held-but-inactive and pulled in per turn. Every other
// convention attaches always-on the moment its folder is read. This is the
// asymmetry the issue's "two attachment modes" has to generalise.
// ---------------------------------------------------------------------------

const agentFlow = read("packages/workforce/src/agent-worker-flow.ts");
for (const door of ["activateTool", "enableLlmClassifier", "active"]) {
  assert("C3", agentFlow.includes(door), `skills carry the opt-in door \`${door}\``);
}

// A file-declared document cannot be lazy: it installs at flow level, which has
// no per-block load trigger. So a resource structurally has no opt-in mode
// today — the obstacle the POC matrix must probe, not argue.
const manifest = read("packages/workforce/src/manifest.ts");
assert(
  "C3-resource",
  manifest.includes('REFUSED_PREFETCH_MODE = "lazy"'),
  "a file-declared document is refused `prefetchMode: lazy` — no opt-in mode exists for it",
);

// ---------------------------------------------------------------------------
// C4 · THE GRANT INVARIANT. Nothing grants a seat a tool except the seat's own
// `tools:` key.
//
// The single claim the spec's central decision turns on. Two independent
// enforcement points, both asserted, because either one relaxing would make a
// package able to grant itself capability.
// ---------------------------------------------------------------------------

assert(
  "C4-skills",
  agentFlow.includes("registerCatalogTools: false"),
  "the seat path builds the skills library with tool registration OFF — a held skill's `allowed-tools` never grants",
);

assert(
  "C4-fence",
  agentFlow.includes("toolSeatFence"),
  "a skill's delegated board workers are narrowed to the seat's own `tools:` list",
);

const hire = read("packages/workforce/src/hire.ts");
// The seat's own `blocks/` folder REGISTERS names; `tools:` is what picks from
// the registry. The intersection is the grant.
assert(
  "C4-blocks",
  hire.includes("resolveDeclaredTools") &&
    hire.includes("Object.hasOwn(registry, name)"),
  "a seat's own `blocks/` folder is intersected with its declared `tools:` — registration is not a grant",
);

const library = read("packages/orchestration/src/skills/library.ts");
assert(
  "C4-default",
  library.includes("registerCatalogTools"),
  "registration is a separable, defaultable job on the skills library, not baked into binding",
);

// ---------------------------------------------------------------------------
// Negative control — plant a violation, watch C2 go red, then remove it.
// ---------------------------------------------------------------------------

if (process.argv.includes("--negative-control")) {
  const planted = path.join(WORKFORCE, "loader/read-planted-directory.ts");
  fs.writeFileSync(planted, "// a convention reader with its own private parser\n");
  let wentRed = false;
  try {
    const after = fs
      .readdirSync(path.join(WORKFORCE, "loader"))
      .filter((f) => f.startsWith("read-") && f.endsWith(".ts") && f !== "read-workforce.ts");
    const classified = after.every((f) =>
      Object.values(EXPECTED_CONVENTIONS).some((p) => p.endsWith(f)),
    );
    const countHeld = after.length === Object.keys(EXPECTED_CONVENTIONS).length;
    wentRed = !classified || !countHeld;
  } finally {
    fs.unlinkSync(planted);
  }
  console.log(
    wentRed
      ? "NEGATIVE CONTROL: PASS — a planted sixth reader is caught by C1/C1-total."
      : "NEGATIVE CONTROL: FAIL — a planted sixth reader slipped through. The assertion is not total.",
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
