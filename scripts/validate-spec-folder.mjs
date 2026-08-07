#!/usr/bin/env node
/**
 * Guards the two ways a point-in-time spec leaks into `main`.
 *
 * 1. `spec/` carries the in-flight spec on a spec branch and must be empty
 *    (README only) everywhere else. Spec PRs legitimately carry one, so CI
 *    skips this script for them by label; every other PR and `main` itself is
 *    checked.
 * 2. Source and docs must not cite a spec by repo path. The spec copy dies with
 *    its PR, so a `spec/FIX-123.md` reference is dangling the moment it is
 *    written — a comment states its reason, it does not link to one.
 *
 * Exits non-zero with the offending paths and the fix. No dependencies, so CI
 * runs it without an install.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SPEC_DIR = join(ROOT, "spec");

/** Files allowed to live in `spec/` on a non-spec branch. */
const ALLOWED = new Set(["README.md"]);

/** Trees worth scanning for dangling spec citations. */
const SCAN_ROOTS = ["packages", "apps", "labs", "examples", "scripts", "docs"];
const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json|yml|yaml)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage"]);

/**
 * Matches a citation of a spec file by repo path — `spec/FIX-123.md` or the
 * retired `docs/specs/FIX-123.md`. Deliberately narrow: it wants a concrete
 * spec filename, not a mention of the folder itself.
 */
const SPEC_CITATION = /(?:docs\/specs|spec)\/[A-Z]{2,6}-\d+(?:[^\s`"')]*)?\.md/g;

/** Paths that describe the convention and therefore name these paths on purpose. */
const CITATION_EXEMPT = [
  "spec/README.md",
  "docs/contributing/",
  "docs/internal/",
  "scripts/validate-spec-folder.mjs",
  ".agents/",
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

function checkSpecFolderEmpty() {
  let entries;
  try {
    entries = readdirSync(SPEC_DIR);
  } catch {
    return []; // No spec/ at all is fine — nothing to leak.
  }
  return entries.filter((name) => !ALLOWED.has(name));
}

function checkDanglingCitations() {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      if (CITATION_EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(SPEC_CITATION)) {
          hits.push({ file: rel, line: i + 1, text: match[0] });
        }
      });
    }
  }
  return hits;
}

const stray = checkSpecFolderEmpty();
const citations = checkDanglingCitations();

if (stray.length === 0 && citations.length === 0) {
  console.log("✓ spec/ is clear and no spec paths are cited");
  process.exit(0);
}

if (stray.length > 0) {
  console.error(`\n✗ spec/ must hold nothing but README.md here. Found ${stray.length}:\n`);
  for (const name of stray) console.error(`    spec/${name}`);
  console.error(
    `\n  A spec lives on its own spec PR and in Linear — it never reaches main.` +
      `\n  If this is the spec PR, it needs the "spec" label so CI skips this check.` +
      `\n  Otherwise remove the file; the Linear document is the durable copy.\n`,
  );
}

if (citations.length > 0) {
  console.error(`\n✗ ${citations.length} reference(s) to a spec by repo path:\n`);
  for (const hit of citations) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
  console.error(
    `\n  Spec files do not exist on main, so these are dangling.` +
      `\n  State the reason at the call site instead of linking to a document,` +
      `\n  or move the durable part into docs/architecture/ and cite that.\n`,
  );
}

process.exit(1);
