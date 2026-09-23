#!/usr/bin/env node
/**
 * Guards legacy spec artifacts and dangling local citations.
 *
 * Issue and epic specs are retained under `specs/issues/` and `specs/epics/`,
 * including their authored assets and isolated POCs. Those paths may be cited.
 * The legacy `spec/` and `spec-poc/` directories must remain README-only on
 * mergeable branches. Project specs still live at `spec/_projects/` on their
 * never-merged branches; CI exempts only `project/*` PRs from this guard.
 *
 * Maintained source, docs and retained specs must not cite obsolete local
 * `docs/specs/` or never-merged `spec/` files. External historical URLs are
 * provenance, not local citations, and remain valid.
 *
 * Exits non-zero with the offending paths and the fix. No dependencies, so CI
 * runs it without an install.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Legacy directories stay empty on mergeable branches. Project specs retain
 * their never-merged lifecycle under `spec/_projects/`.
 */
const EPHEMERAL_DIRS = ["spec", "spec-poc"];

/** The only file allowed in legacy directories outside a project branch. */
const ALLOWED = new Set(["README.md"]);

/** Trees worth scanning for dangling spec citations. */
const SCAN_ROOTS = [
  "packages",
  "apps",
  "labs",
  "examples",
  "scripts",
  "docs",
  "specs",
  ".agents",
  ".changeset",
  ".github",
];

/**
 * Root-level docs are maintained surfaces too, and no tree above reaches them.
 * They name the path *shape* (`spec/<ISSUE-ID>/SPEC.md`), which the patterns
 * below deliberately don't match — an angle-bracket placeholder is not a citation.
 */
const SCAN_FILES = ["README.md", "CLAUDE.md", "AGENTS.md"];

const SCAN_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|md|mdx|json|yml|yaml)$/;
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
 * Concrete legacy `spec/` citations still dangle: retained issue/epic artifacts
 * use `specs/`, and projects never merge. Placeholders remain useful in process
 * docs and do not match. External URLs may preserve historical artifacts, so
 * remove those tokens before checking local paths; never skip the entire line.
 */
const RETIRED_PATH = /docs\/specs\/[^\s`"')]*/g;
const RETIRED_EXEMPT = [
  "scripts/validate-spec-folder.mjs",
  "packages/core/test/spec-folder-check.test.ts",
  "docs/internal/",
];

// Preserve the legacy guard's scope: spec prose and figures, not a general link checker.
const SPEC_CITATION =
  /(?<!docs\/)\bspec\/(?:[A-Z]{2,6}-\d+(?:[^\s`"')]*)?|_(?:epics|projects)\/[^\s<>`"')]+)\.(?:md|svg)/g;
const CITATION_EXEMPT = [
  "docs/internal/",
  "scripts/validate-spec-folder.mjs",
  "packages/core/test/spec-folder-check.test.ts",
];
const EXTERNAL_URL = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;

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
 * Scan in-memory sources for obsolete local paths, preserving historical URL
 * provenance and the narrow exemptions for guard fixtures and internal records.
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
      const localText = line.replace(EXTERNAL_URL, "");
      if (!skipRetired) {
        for (const match of localText.matchAll(RETIRED_PATH)) {
          retired.push({ file: rel, line: i + 1, text: match[0] });
        }
      }
      if (!skipCitation) {
        for (const match of localText.matchAll(SPEC_CITATION)) {
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
    console.log("✓ legacy spec folders are clear and no dangling legacy spec paths are cited");
    process.exit(0);
  }

  if (retired.length > 0) {
    console.error(`\n✗ ${retired.length} reference(s) to the retired docs/specs/ tree:\n`);
    for (const hit of retired) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(
      `\n  That directory no longer exists. Retained issue and epic specs live under` +
        `\n  specs/issues/ and specs/epics/. Cite an existing retained artifact or historical URL.\n`,
    );
  }

  if (stray.length > 0) {
    console.error(
      `\n✗ spec/ and spec-poc/ must hold nothing but README.md here. Found ${stray.length}:\n`,
    );
    for (const name of stray) console.error(`    ${name}`);
    console.error(
      `\n  Retain issue and epic specs, assets and POCs under specs/issues/ or specs/epics/.` +
        `\n  Only project specs remain on never-merged project/* branches.` +
        `\n  CI checks issue/epic PRs and main; only project/* PRs are exempt.\n`,
    );
  }

  if (citations.length > 0) {
    console.error(`\n✗ ${citations.length} dangling legacy spec citation(s):\n`);
    for (const hit of citations) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(
      `\n  These legacy spec files do not exist on main.` +
        `\n  Cite an existing retained artifact under specs/, use a historical URL,` +
        `\n  or state the reason at the call site.\n`,
    );
  }

  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
