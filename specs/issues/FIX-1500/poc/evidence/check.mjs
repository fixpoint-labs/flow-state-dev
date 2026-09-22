/**
 * FIX-1500 · the spec's factual base, re-derived from the tree.
 *
 * Three claims in this spec are counted or enumerated, and a hand-derived
 * count is the class of evidence that does not converge by being argued
 * about. Each one gets an assertion here, and each assertion has a negative
 * control that must be seen to fail (`--plant`).
 *
 *   C1  TOTALITY. Every resource collection `packages/workforce/src` defines
 *       is classified: browser-readable (it declares `client.state.read`) or
 *       deliberately not. An unclassified collection fails the run — a check
 *       that only verifies the collections it already knows about cannot
 *       report the one nobody listed.
 *
 *   C2  The durable-hire sequence — `roster.create(...)` followed by
 *       `registerFromRoster(...)` — lives at exactly one site in the tree.
 *       This is the invariant FIX-1500 gives a convergence point; if it is
 *       already in two places, the spec's premise is wrong.
 *
 *   C3  The kitchen-sink hire door is registered only when an admin
 *       credential is configured, so a default deployment has no hire path.
 *
 * Throwaway. It reads files and spawns nothing; it is not wired into any
 * suite and nothing in production imports it.
 *
 *   node specs/issues/FIX-1500/poc/evidence/check.mjs           # assert
 *   node specs/issues/FIX-1500/poc/evidence/check.mjs --plant   # negative control
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
const appFiles = [
  ...walk(join(ROOT, "apps/kitchen-sink/flows")),
  ...walk(join(ROOT, "apps/kitchen-sink/workforce")),
  ...walk(join(ROOT, "packages/workforce/src")),
];
const hireSites = appFiles.filter((f) => {
  const src = readFileSync(f, "utf8");
  return /\.create\(/.test(src) && /registerFromRoster\s*\(/.test(src);
});
notes.push(
  `C2  ${hireSites.length} site(s) pair a roster create() with registerFromRoster(): ` +
    hireSites.map((f) => relative(ROOT, f)).join(", ")
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
  process.exit(1);
}
console.log("OK");
