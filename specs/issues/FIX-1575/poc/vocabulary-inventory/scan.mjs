// Shared scanner: the audit's scope and vocabulary, and the hits they produce.
// Retained spec evidence (FIX-1575), not production code; nothing imports it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Workforce-private words, as prose and as part of a camelCase identifier. */
export const VOCAB = [
  /\b(seats?|hir(?:e|ed|es|ing)|roster|workforce)\b/i,
  /(Seat|Hire|Roster|Workforce)|\b(seat|hire|roster|workforce)[A-Z]/,
];

/** Directories whose source is in scope, and single files in scope. */
const SOURCE_DIRS = ["packages/core/src", "packages/engine/src", "packages/contracts/src"];
const FILES = [
  "packages/core/README.md",
  "packages/engine/README.md",
  "packages/contracts/README.md",
  "packages/scheduled/README.md",
  "docs/contributing/best-practices/resources.md",
];
const ARCH_DIR = "docs/architecture";

/** Tests exercise the mechanism, often Workforce's use of it on purpose; out of scope (DECISIONS). */
export function isTestPath(rel) {
  return /(^|\/)(test|tests)\//.test(rel) || /\.(test|type-test)\.[cm]?[jt]sx?$/.test(rel);
}

function walk(root, dir, acc) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, rel, acc);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !isTestPath(rel)) acc.push(rel);
  }
  return acc;
}

/** Every in-scope file, relative to the repo root. */
export function scopeFiles(root) {
  const files = [];
  for (const dir of SOURCE_DIRS) walk(root, dir, files);
  for (const file of FILES) if (statSync(path.join(root, file), { throwIfNoEntry: false })) files.push(file);
  for (const name of readdirSync(path.join(root, ARCH_DIR))) {
    // Workforce's own architecture docs are Layer 2's, not contamination.
    if (name.endsWith(".md") && !name.startsWith("workforce-")) files.push(path.join(ARCH_DIR, name));
  }
  return files.sort();
}

/** One hit per matching line: `{ file, line, text }`. */
export function scan(root) {
  const hits = [];
  for (const file of scopeFiles(root)) {
    readFileSync(path.join(root, file), "utf8").split("\n").forEach((text, i) => {
      if (VOCAB.some((re) => re.test(text))) hits.push({ file, line: i + 1, text });
    });
  }
  return hits;
}
