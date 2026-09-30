#!/usr/bin/env node
/**
 * Keep one copy of the Windows reserved device-name list in the repo (FIX-1428).
 *
 * `con`, `prn`, `aux`, `nul`, `com1`–`com9` and `lpt1`–`lpt9` are names Windows
 * will not create as a file or folder. The list lives once, in
 * `packages/contracts/src/helpers/windows-reserved-name.ts`, and every place
 * that applies the rule calls `isWindowsReservedName` from
 * `@flow-state-dev/core/helpers`. Before that, three copies were kept by hand
 * in three packages, and nothing noticed when one of them drifted. This script
 * is what notices.
 *
 * ## What this checks, and what it does not
 *
 * **Every git-tracked JS/TS file, tests included**, except the files listed in
 * `ALLOWED_FILES`. A copy found in a test counts: a test that keeps its own
 * list drifts as surely as source does.
 *
 * **Matched by encoding, not by name**, because a new copy will not reuse a
 * known variable name. Three shapes, each a way the list gets written:
 *
 *   quoted-prn     a quoted "prn" ("prn", 'prn', `prn`)       non-test files only
 *   templated      a templated numbered device (`com${…}`)    every file
 *   regex-class    a regex class on a numbered device (com[1-9]) every file
 *
 * The last two only ever spell a whole range, so they are list-shaped wherever
 * they appear. A quoted `prn` is not: a test legitimately passes `"PRN"` as
 * one hostile input, which names a case rather than keeping the list, so in
 * test files it is not a hit.
 *
 * **Known gap:** a test that spells the whole list as separate plain literals
 * is not caught. Accepted for now; widen the rules only if a copy actually
 * lands in that shape.
 *
 * Exits non-zero with each offending file and the import to use instead.
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Files allowed to spell the list. Each is a single file, never a tree, and
 * each says why beside it.
 */
const ALLOWED_FILES = new Set([
  // The one list.
  "packages/contracts/src/helpers/windows-reserved-name.ts",
  // This guard, and the test that plants copies to prove it fails on them.
  "scripts/validate-reserved-names.mjs",
  "packages/core/test/reserved-names-check.test.ts",
  // Retained spec evidence: the census that counted the copies before the
  // list was consolidated. It carries the same signatures as this script in
  // order to find them; nothing runs it by default.
  "specs/issues/FIX-1428/poc/copy-census/census.mjs",
]);

const RULES = [
  { rule: "quoted-prn", re: /["'`]prn["'`]/i, inTests: false },
  { rule: "templated", re: /\b(?:com|lpt)\$\{/i, inTests: true },
  { rule: "regex-class", re: /\b(?:com|lpt)\[[0-9]/i, inTests: true },
];

/** Whether one repo-relative path is inside the scanned surface. Pure. */
export function isScannedPath(relPath) {
  const norm = relPath.split("\\").join("/");
  if (ALLOWED_FILES.has(norm)) return false;
  return CODE.test(norm);
}

/**
 * Scan in-memory sources, returning `{ file, line, text, rule }` per hit.
 * Pure and filesystem-free so the rules are testable from fixture text.
 */
export function scanSources(sources) {
  const hits = [];
  for (const { path, text: body } of sources) {
    const isTest = TEST.test(path);
    body.split("\n").forEach((text, index) => {
      for (const { rule, re, inTests } of RULES) {
        if (isTest && !inTests) continue;
        if (re.test(text)) hits.push({ file: path, line: index + 1, text: text.trim(), rule });
      }
    });
  }
  return hits;
}

/** Every git-tracked file in the scanned surface. Symlinks are skipped. */
function collectFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((rel) => rel !== "" && isScannedPath(rel))
    .filter((rel) => {
      try {
        return lstatSync(join(ROOT, rel)).isFile();
      } catch (error) {
        // A tracked file deleted in the working tree has nothing to scan. Any
        // other failure would silently shrink the scanned surface, so it throws.
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    });
}

function main() {
  const files = collectFiles();
  const hits = scanSources(
    files.map((rel) => ({ path: rel, text: readFileSync(join(ROOT, rel), "utf8") })),
  );

  if (hits.length === 0) {
    console.log(`✓ One Windows reserved-name list (${files.length} files scanned).`);
    return;
  }

  const byFile = new Map();
  for (const hit of hits) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit]);

  console.error(`\n✗ ${byFile.size} file(s) keep their own copy of the Windows reserved-name list:\n`);
  for (const [file, fileHits] of byFile) {
    for (const hit of fileHits) console.error(`    ${file}:${hit.line}  [${hit.rule}]  →  ${hit.text}`);
  }
  console.error(
    `\n  Import \`isWindowsReservedName\` from "@flow-state-dev/core/helpers" instead.` +
      `\n  The one list is packages/contracts/src/helpers/windows-reserved-name.ts.\n`,
  );
  process.exit(1);
}

/** The allowlist, exported so its test drives cases from the real set. */
export const allowedFiles = [...ALLOWED_FILES];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
