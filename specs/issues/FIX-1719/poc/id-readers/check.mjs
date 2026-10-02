#!/usr/bin/env node
/**
 * FIX-1719 spec evidence: every place that reads a seat id by splitting it on
 * a dot, classified. Not production code, and nothing imports it.
 *
 * Today every declared seat id is `<team>.<name>`. An org seat's id is the
 * bare folder name, so each reader that splits an id has to be either changed
 * (PLAN.md surface S2) or shown not to read seat ids. This re-derives that list
 * from the source tree and fails when a split appears that the spec did not
 * classify (totality), or when a classified site has moved or gone.
 *
 *   node specs/issues/FIX-1719/poc/id-readers/check.mjs          # expect PASS
 *   PLANT=1 node specs/issues/FIX-1719/poc/id-readers/check.mjs  # negative control, expect FAIL
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const roots = ["packages/workforce/src", "labs/shift-manager/src"];
const SPLIT = /\b(?:indexOf|lastIndexOf|split)\("\."\)/;

/** file → why it is in or out of S2. Keyed by file, not line, so an edit nearby doesn't break it. */
// After PR 1: `read-workforce.ts`'s `splitWorkerId` is gone (it calls
// `parseDeclaredSeatId`), so it no longer splits and is not listed.
const CLASSIFIED = {
  "packages/workforce/src/seat-packages.ts": "IN · resolveHeldPackages: strips a hired seat's org, then parseDeclaredSeatId",
  "packages/workforce/src/seat-references.ts": "IN · parseDeclaredSeatId, the one rule; placeOfSeat calls it",
  "labs/shift-manager/src/lib/derive.ts": "SEAM · chiefOfStaffOf: the name after the first dot, a dotless id whole; the Shift Manager screens own it",
  "packages/workforce/src/roster/address.ts": "OUT · splitSeatAddress: a hired address <org>.<seatId>, not a declared id",
  "packages/workforce/src/channel/channel-flow.ts": "OUT · board ids <channel>.<board>",
  "packages/workforce/src/hire.ts": "OUT · board ids, in unattendedBoardWarnings",
  "labs/shift-manager/src/lib/reads.ts": "SEAM · toSeat: reads a dotless id as its own team; FIX-1723 owns the screen",
  "labs/shift-manager/src/lib/task.tsx": "OUT · board refs",
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\./.test(entry)) yield full;
  }
}

const found = new Set();
for (const root of roots) {
  for (const file of walk(path.join(repo, root))) {
    if (SPLIT.test(readFileSync(file, "utf8"))) found.add(path.relative(repo, file));
  }
}
if (process.env.PLANT === "1") found.add("packages/workforce/src/planted-unclassified.ts");

const unclassified = [...found].filter((f) => !(f in CLASSIFIED));
const gone = Object.keys(CLASSIFIED).filter((f) => !found.has(f));
for (const f of [...found].sort()) console.log(`${CLASSIFIED[f] ?? "UNCLASSIFIED"}  ${f}`);
if (unclassified.length > 0 || gone.length > 0) {
  if (unclassified.length > 0) console.error(`FAIL · unclassified id split: ${unclassified.join(", ")}`);
  if (gone.length > 0) console.error(`FAIL · classified site no longer splits: ${gone.join(", ")}`);
  process.exit(1);
}
console.log(`PASS · ${found.size} sites, all classified`);
