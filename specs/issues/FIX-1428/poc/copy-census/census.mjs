#!/usr/bin/env node
/**
 * FIX-1428 spec evidence (retained POC, not production code): re-derive the
 * count the spec rests on — how many independently maintained copies of the
 * Windows reserved device-name list exist in tracked code.
 *
 * Totality: every git-tracked JS/TS file is scanned (tests included); each is
 * classified as holding a copy or clean, and the census prints both totals so
 * a reader can see nothing was silently skipped.
 *
 * Signature (matched by encoding, not by name — every known copy uses at least
 * one):
 *   S1  a quoted "prn"                     ("prn", 'prn', `prn`)  — non-test files only
 *   S2  a templated numbered device        (`com${…}`, `lpt${…}`) — every file
 *   S3  a regex class on a numbered device (com[1-9], lpt[1-9])   — every file
 * S2 and S3 only ever spell a whole range, so they are list-shaped wherever
 * they appear. S1 is not: a test legitimately passes "PRN" as one hostile
 * input, which names a case rather than maintaining the list — so in test
 * files S1 is not a hit. Known gap: a test that spells the whole list as
 * explicit literals is not caught.
 *
 *   node specs/issues/FIX-1428/poc/copy-census/census.mjs          # census
 *   node specs/issues/FIX-1428/poc/copy-census/census.mjs --plant  # negative control
 *
 * --plant adds two in-memory files carrying extra copies (see PLANTS) and
 * exits non-zero unless the census reports both.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim();
const SELF = path.relative(root, fileURLToPath(import.meta.url));

const SIGNATURES = [
  ["S1", /["'`]prn["'`]/i, false],
  ["S2", /\b(?:com|lpt)\$\{/i, true],
  ["S3", /\b(?:com|lpt)\[[0-9]/i, true],
];
const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

function hitsIn(file, text) {
  const isTest = TEST.test(file);
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const [id, re, inTests] of SIGNATURES) {
      if (isTest && !inTests) continue;
      if (re.test(line)) hits.push(`${i + 1}:${id}`);
    }
  });
  return hits;
}

const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => CODE.test(f) && f !== SELF);

const corpus = files.map((f) => [f, readFileSync(path.join(root, f), "utf8")]);
const plant = process.argv.includes("--plant");
// Two plants: a source copy spelled a new way (a regex, no "prn"), and a test
// copy (templated) to prove tests are scanned too.
const PLANTS = [
  ["packages/planted/src/names.ts", "export const R = /^(con|aux|nul|com[1-9]|lpt[1-9])$/i;\n"],
  ["packages/planted/test/names.test.ts", "const R = new Set(Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`));\n"],
];
if (plant) corpus.push(...PLANTS);

let clean = 0;
const copies = [];
for (const [f, text] of corpus) {
  const hits = hitsIn(f, text);
  if (hits.length) copies.push([f, hits]);
  else clean += 1;
}

console.log(`scanned ${corpus.length} files · clean ${clean} · holding a copy ${copies.length}`);
for (const [f, hits] of copies) console.log(`  ${f}  ${hits.join(" ")}`);
if (clean + copies.length !== corpus.length) throw new Error("classification is not total");

if (plant) {
  const missed = PLANTS.filter(([p]) => !copies.some(([f]) => f === p)).map(([p]) => p);
  if (missed.length) {
    console.error(`CONTROL FAILED: planted copies not reported: ${missed.join(", ")}`);
    process.exit(1);
  }
  console.log("control: both planted copies reported, as they must be");
}
