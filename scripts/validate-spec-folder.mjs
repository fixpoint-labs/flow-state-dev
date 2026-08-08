#!/usr/bin/env node
/**
 * Guards the two ways a point-in-time spec leaks into `main`.
 *
 * 1. `spec/` carries the in-flight spec on a spec branch, and `spec-poc/` the
 *    throwaway POC backing it. Both die with the spec PR, so both must be empty
 *    (README only) everywhere else. Spec and epic PRs legitimately carry them,
 *    so CI skips this script for them by BRANCH name (`spec/*`, `epic/*` — see
 *    `.github/workflows/ci.yml`, which explains why the `spec` label can't be
 *    the key); every other PR and `main` itself is checked.
 * 2. Source and docs must not cite a spec by repo path. The spec copy dies with
 *    its PR, so a `spec/FIX-123.md` or `spec/_epics/<name>.md` reference is
 *    dangling the moment it is written — a comment states its reason, it does
 *    not link to one.
 *
 * Exits non-zero with the offending paths and the fix. No dependencies, so CI
 * runs it without an install.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * The never-merged directories, per `spec/README.md`: the spec itself, and the
 * throwaway POC that backs it. Both are point-in-time artifacts that die with
 * the spec PR, so both leak onto `main` the same way and are checked together.
 */
const EPHEMERAL_DIRS = ["spec", "spec-poc"];

/** The only file allowed to live in those directories on a non-spec branch. */
const ALLOWED = new Set(["README.md"]);

/** Trees worth scanning for dangling spec citations. */
const SCAN_ROOTS = [
  "packages",
  "apps",
  "labs",
  "examples",
  "scripts",
  "docs",
  ".agents",
  ".changeset",
  ".github",
];

/**
 * Root-level docs are maintained surfaces too, and no tree above reaches them.
 * They name the path *shape* (`spec/<ISSUE-ID>.md`), which the patterns below
 * deliberately don't match — an angle-bracket placeholder is not a citation.
 */
const SCAN_FILES = ["README.md", "CLAUDE.md", "AGENTS.md"];

const SCAN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json|yml|yaml)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage"]);

/**
 * Two patterns, two bars, because they are wrong for different reasons.
 *
 * The retired `docs/specs/` tree no longer exists at all, so *any* mention of a
 * file in it is stale — including in the process docs that describe the
 * convention, which is exactly where the last few survived a rename. Only this
 * script and its test (both of which must name a pattern to match it) and the
 * historical record under `docs/internal/` are exempt.
 *
 * A `spec/FIX-123.md` citation is a dangling pointer in code. The docs that
 * define the convention need no exemption for it — they write the *placeholder*,
 * which neither pattern matches, so the distinction does the work an exempt list
 * would otherwise have to. Only the two files that must quote a concrete path to
 * match it (this script and its test) are exempt.
 *
 * Both spec shapes are dangling for the same reason — an epic PR (`epic/<name>`,
 * carrying `spec/_epics/<name>.md`) is never merged either, so a link to it dies
 * with the PR exactly like an issue spec's. Neither arm matches an angle-bracket
 * placeholder: `[A-Z]{2,6}-\d+` can't match `<ISSUE-ID>`, and the epic arm
 * excludes `<>` for the same reason. Docs describing the convention write the
 * placeholder; only a concrete path is a citation.
 */
const RETIRED_PATH = /docs\/specs\/[^\s`"')]*/g;
const RETIRED_EXEMPT = [
  "scripts/validate-spec-folder.mjs",
  "packages/core/test/spec-folder-check.test.ts",
  "docs/internal/",
];

const SPEC_CITATION =
  /(?<!docs\/)\bspec\/(?:[A-Z]{2,6}-\d+(?:[^\s`"')]*)?|_epics\/[^\s<>`"')]+)\.md/g;
const CITATION_EXEMPT = [
  "docs/internal/",
  "scripts/validate-spec-folder.mjs",
  "packages/core/test/spec-folder-check.test.ts",
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

function checkEphemeralDirsEmpty() {
  const stray = [];
  for (const dir of EPHEMERAL_DIRS) {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      continue; // Absent entirely is fine — nothing to leak.
    }
    for (const name of entries) {
      if (!ALLOWED.has(name)) stray.push(`${dir}/${name}`);
    }
  }
  return stray;
}

/**
 * Scan in-memory sources. Exported so the two patterns and both exempt lists can
 * be tested against fixtures — placeholder vs concrete path, issue spec vs epic
 * spec, exempt tree vs scanned tree — without touching the repo's real files.
 *
 * @param {Array<{ path: string, text: string }>} sources — `path` repo-relative.
 */
export function scanSources(sources) {
  const hits = [];
  const retired = [];
  for (const { path: rel, text } of sources) {
    const skipRetired = RETIRED_EXEMPT.some((prefix) => rel.startsWith(prefix));
    const skipCitation = CITATION_EXEMPT.some((prefix) => rel.startsWith(prefix));
    text.split("\n").forEach((line, i) => {
      if (!skipRetired) {
        for (const match of line.matchAll(RETIRED_PATH)) {
          retired.push({ file: rel, line: i + 1, text: match[0] });
        }
      }
      if (!skipCitation) {
        for (const match of line.matchAll(SPEC_CITATION)) {
          hits.push({ file: rel, line: i + 1, text: match[0] });
        }
      }
    });
  }
  return { hits, retired };
}

/** Read every scanned tree and root-level doc, then hand them to `scanSources`. */
function checkDanglingCitations() {
  const files = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root)));
  for (const name of SCAN_FILES) files.push(join(ROOT, name));

  const sources = [];
  for (const file of files) {
    try {
      sources.push({ path: relative(ROOT, file), text: readFileSync(file, "utf8") });
    } catch {
      // A root doc that doesn't exist here is not a finding.
    }
  }
  return scanSources(sources);
}

function main() {
  const stray = checkEphemeralDirsEmpty();
  const { hits: citations, retired } = checkDanglingCitations();

  if (stray.length === 0 && citations.length === 0 && retired.length === 0) {
    console.log("✓ spec/ and spec-poc/ are clear and no spec paths are cited");
    process.exit(0);
  }

  if (retired.length > 0) {
    console.error(`\n✗ ${retired.length} reference(s) to the retired docs/specs/ tree:\n`);
    for (const hit of retired) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(
      `\n  That directory no longer exists. Specs live at spec/<ISSUE-ID>.md on their` +
        `\n  spec branch, and in Linear after it closes. Update the path.\n`,
    );
  }

  if (stray.length > 0) {
    console.error(
      `\n✗ spec/ and spec-poc/ must hold nothing but README.md here. Found ${stray.length}:\n`,
    );
    for (const name of stray) console.error(`    ${name}`);
    console.error(
      `\n  A spec and its POC live on the spec PR and in Linear — never on main.` +
        `\n  CI skips this check on a spec branch (spec/*) or an epic branch (epic/*).` +
        `\n  Adding the "spec" label will NOT skip it — the exemption is the branch name.` +
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
}

/** The scanned surface, exported so a test can assert it still reaches the root docs. */
export const scanRoots = SCAN_ROOTS;
export const scanFiles = SCAN_FILES;

/** The never-merged directories, exported so a test can assert both are covered. */
export const ephemeralDirs = EPHEMERAL_DIRS;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
