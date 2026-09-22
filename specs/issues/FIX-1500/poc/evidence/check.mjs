/**
 * FIX-1500 · the spec's factual base, re-derived from the tree.
 *
 * Three claims in this spec are counted or enumerated, and a hand-derived
 * count is the class of evidence that does not converge by being argued
 * about. Each one gets an assertion here.
 *
 * WHICH OF THEM IS FALSIFIABLE, EXACTLY — because an earlier version of this
 * header claimed a negative control for all three and had one, and saying so
 * in the artifact built to stop unchecked claims is the failure it exists to
 * prevent:
 *
 *   C1  HAS a negative control. `--plant` writes an unclassified collection
 *       into the package and C1 must reject it. Run it; a totality assertion
 *       never seen to go red is not evidence.
 *   C2  HAS NO negative control. It is a one-shot count against the current
 *       tree. See its own note for what its predicate can and cannot support.
 *   C3  HAS NO negative control. It is a one-shot read of one config
 *       expression against the current tree.
 *
 *   C1  TOTALITY. Every resource collection `packages/workforce/src` defines
 *       is classified: browser-readable (it declares `client.state.read`) or
 *       deliberately not. An unclassified collection fails the run — a check
 *       that only verifies the collections it already knows about cannot
 *       report the one nobody listed.
 *
 *   C2  The durable-hire sequence — a hired-roster `create(...)` followed by
 *       `registerFromRoster(...)` — lives at exactly one site in the tree.
 *       This is the invariant FIX-1500 gives a convergence point; if it is
 *       already in two places, the spec's premise is wrong. Source-level and
 *       proximity-based, NOT semantic: see the predicate's own note.
 *
 *   C3  The kitchen-sink hire door is registered only when an admin
 *       credential is configured, so a default deployment has no hire path.
 *
 * Throwaway. It reads files and spawns nothing; it is not wired into any
 * suite and nothing in production imports it.
 *
 *   node specs/issues/FIX-1500/poc/evidence/check.mjs           # assert
 *   node specs/issues/FIX-1500/poc/evidence/check.mjs --plant   # C1's negative control
 */

import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const WORKFORCE = join(ROOT, "packages/workforce/src");
const PLANT = process.argv.includes("--plant");

/** Every `.ts` file under a directory, excluding tests. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * The spec's classification of every collection this package defines. The
 * assertion is that the tree and this table agree — a collection in neither
 * column is what C1 exists to catch, and a planted one lands there.
 *
 *   readable   already serves a browser, or FIX-1500 makes it serve one
 *   withheld   deliberately not browser-readable, with the reason
 *
 * `opens` marks the three FIX-1500 itself opens. Before implementation those
 * rows are the run's reported DELTA; after it, the delta is empty. Both states
 * are meaningful, which is what stops this being a check that cannot fail.
 */
const CLASSIFIED = {
  readable: {
    "${HIRED_ROSTER_PREFIX}*": { opens: false }, // FIX-1477 D4
    "<task-collection>@channel-board": { opens: false }, // FIX-1477 D4
    "inventory/seats/*": { opens: true },
    "inventory/channels/*": { opens: true },
    // `**`, not `*`: a membership topic is `<seatId>/<channelId>`, and only the
    // double star admits the slash. The single-star spelling was this table's
    // first draft and this check is what corrected it.
    "inventory/members/**": { opens: true },
  },
  withheld: {
    "<persona-factory>":
      "definePersona forwards a pattern its CALLER supplies — it fixes no address, " +
      "so whether such a collection serves a browser is the caller's declaration, not this package's",
  },
};

const failures = [];
const notes = [];

// ---------------------------------------------------------------- C1 totality
const files = walk(WORKFORCE);
const collections = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  // Every collection-defining call in the package, by the three factories it uses.
  const factoryRe = /(defineResourceCollection|defineTaskCollection)\s*\(/g;
  let m;
  while ((m = factoryRe.exec(src)) !== null) {
    // The factory's argument object, to its balanced close.
    let depth = 0;
    let i = factoryRe.lastIndex - 1;
    let end = -1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const call = src.slice(factoryRe.lastIndex - 1, end + 1);
    // A `defineTaskCollection` may be wrapped in an `Object.assign` that adds
    // the client declaration beside it, so widen the window to the statement.
    const lineStart = src.lastIndexOf("\n", factoryRe.lastIndex - 1) + 1;
    const stmtEnd = src.indexOf("\n\n", end);
    const statement = src.slice(lineStart, stmtEnd === -1 ? end + 1 : stmtEnd);
    // The storage pattern, in the three spellings this package uses: a literal,
    // a template interpolating a pinned prefix constant, and an options-driven
    // one. Falling through to the factory name keeps an unrecognised spelling
    // VISIBLE rather than silently collapsing it onto another row's identity.
    const literal = /pattern:\s*["'`]([^"'`$]*)["'`]/.exec(call)?.[1];
    const templated = /pattern:\s*`\$\{([A-Za-z_]+)\}([^`]*)`/.exec(call);
    const optioned = /pattern:\s*`\$\{(\w+)\}\/\*\*`/.test(call);
    const pattern =
      literal ??
      (templated ? `\${${templated[1]}}${templated[2]}` : undefined) ??
      (optioned ? "<option-prefixed>" : undefined) ??
      `<${m[1]}@${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}>`;
    const readable = /state:\s*\{\s*read:\s*true/.test(statement);
    collections.push({
      file: relative(ROOT, file),
      pattern,
      readable,
    });
  }
}

if (PLANT) {
  // The negative control: a collection nothing classifies. C1 must reject it.
  const plantPath = join(WORKFORCE, "__planted-collection.ts");
  writeFileSync(
    plantPath,
    'import { defineResourceCollection } from "@flow-state-dev/core";\n' +
      "export function definePlanted() {\n" +
      '  return defineResourceCollection({ pattern: "planted/*", scope: "org" });\n' +
      "}\n"
  );
  const src = readFileSync(plantPath, "utf8");
  const readable = /state:\s*\{\s*read:\s*true/.test(src);
  collections.push({ file: relative(ROOT, plantPath), pattern: "planted/*", readable });
  rmSync(plantPath);
}

/** A collection-board pattern is `<task-collection@…>`; normalise it to the table's key. */
function key(c) {
  if (c.file.endsWith("channel/channel-board.ts") && !c.pattern.startsWith("inventory"))
    return "<task-collection>@channel-board";
  if (c.file.endsWith("define-persona.ts")) return "<persona-factory>";
  return c.pattern;
}

notes.push(
  `C1  ${collections.length} collection definitions under packages/workforce/src; ` +
    `${collections.filter((c) => c.readable).length} declare a browser read today.`
);
for (const c of collections) {
  notes.push(`      ${c.readable ? "READ " : "  -  "} ${key(c)}  (${c.file})`);
}

// TOTALITY. Every collection in the tree must appear in the table.
const unclassified = collections.filter(
  (c) => CLASSIFIED.readable[key(c)] === undefined && CLASSIFIED.withheld[key(c)] === undefined
);
if (unclassified.length > 0) {
  failures.push(
    `C1 ${unclassified.length} collection(s) are in neither column of the spec's table: ` +
      unclassified.map((c) => `${key(c)} (${c.file})`).join(", ")
  );
}

// And the other direction: a table row naming nothing in the tree is stale.
const present = new Set(collections.map(key));
for (const k of [...Object.keys(CLASSIFIED.readable), ...Object.keys(CLASSIFIED.withheld)]) {
  if (!present.has(k)) failures.push(`C1 the spec's table names "${k}", which the tree does not define`);
}

// The delta FIX-1500 owes: rows marked `opens` that are not yet readable.
const delta = collections.filter(
  (c) => !c.readable && CLASSIFIED.readable[key(c)]?.opens === true
);
notes.push(
  delta.length === 0
    ? `C1  delta: none — every collection the spec opens declares a browser read.`
    : `C1  delta FIX-1500 owes (${delta.length}): ${delta.map(key).join(", ")}`
);

// ------------------------------------------------- C2 one durable-hire sequence
//
// WHAT THIS PREDICATE CAN AND CANNOT SUPPORT. It is a SOURCE-LEVEL,
// PROXIMITY-BASED co-occurrence check, not a semantic one. It requires, in one
// file: a reference to the hired-roster collection, a `.create(` on a
// roster-shaped receiver, and a `registerFromRoster(` within
// SEQUENCE_WINDOW lines of it.
//
// Its first version was `/\.create\(/ && /registerFromRoster\(/` over the whole
// file — ANY `.create(` anywhere co-occurring with the registrar's name. That
// is a NEIGHBOUR of the claim, not the claim: it established neither that the
// create was the roster's nor that the two sat in one sequence. It passed only
// because exactly one file matched. Review caught it.
//
// Even tightened, it cannot prove the two calls are on the same control-flow
// path, and it reads only the three trees below. So the claim it supports is
// "one file in these trees pairs a roster create with a registration nearby",
// which is what D1's extraction premise needs, and NOT "the durable-hire
// sequence is semantically unique in the repository". C2 has no negative
// control — see the file header.
const SEQUENCE_WINDOW = 40;
const appFiles = [
  ...walk(join(ROOT, "apps/kitchen-sink/flows")),
  ...walk(join(ROOT, "apps/kitchen-sink/workforce")),
  ...walk(join(ROOT, "packages/workforce/src")),
];
const hireSites = [];
for (const f of appFiles) {
  const src = readFileSync(f, "utf8");
  // Anchor 1: this file deals in the hired roster at all.
  if (!/defineHiredRosterCollection|HIRED_ROSTER|hiredSeatRow/.test(src)) continue;
  const lines = src.split("\n");
  // Anchor 2: a create() on a roster-shaped receiver, not any create() at all.
  const createLines = [];
  const regLines = [];
  lines.forEach((line, i) => {
    if (/\b(roster|rosterOf\([^)]*\)|rows)\s*(\.|\))?[^;]*\.create\(/.test(line)) createLines.push(i);
    if (/registerFromRoster\s*\(/.test(line)) regLines.push(i);
  });
  // Anchor 3: the two sit in one sequence, not merely in one file.
  const pair = createLines
    .flatMap((c) => regLines.map((r) => ({ c, r })))
    .find(({ c, r }) => r > c && r - c <= SEQUENCE_WINDOW);
  if (pair) hireSites.push({ file: relative(ROOT, f), create: pair.c + 1, register: pair.r + 1 });
}
notes.push(
  `C2  ${hireSites.length} site(s) pair a hired-roster create() with registerFromRoster() ` +
    `within ${SEQUENCE_WINDOW} lines: ` +
    (hireSites.map((h) => `${h.file}:${h.create}→:${h.register}`).join(", ") || "(none)")
);
if (hireSites.length !== 1) {
  failures.push(
    `C2 expected exactly 1 durable-hire site, found ${hireSites.length} — ` +
      `the spec's premise (one site to extract) is wrong`
  );
}

// --------------------------------------------- C3 hire door is fail-closed
const config = readFileSync(join(ROOT, "apps/kitchen-sink/fsdev.config.ts"), "utf8");
const gated = /adminCredentialConfigured\(\)\s*\n?\s*\?\s*\{\s*workforceAdmin/.test(config);
notes.push(`C3  admin flow registration gated on adminCredentialConfigured(): ${gated}`);
if (!gated) {
  failures.push("C3 the admin flow is no longer gated on a configured credential");
}

// ----------------------------------------------------------------- report
console.log(notes.join("\n"));
console.log("");
if (failures.length > 0) {
  console.log("FAIL");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
if (PLANT) {
  console.log("FAIL EXPECTED: the planted collection was accepted — C1 does not assert totality");
  // `--plant` exercises C1 ONLY. C2 and C3 have no red path in this script.
  process.exit(1);
}
console.log("OK");
