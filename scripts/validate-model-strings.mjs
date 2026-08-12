#!/usr/bin/env node
/**
 * Reject removed model-configuration syntax in prose and examples (FIX-1126).
 *
 * `preset/*` model strings and the `presets` resolver option were removed in
 * favour of intents. Both `throw` at runtime — `parseModelString` rejects the
 * first, `createModelResolver`'s option validation rejects the second by name.
 * Neither deprecates, and neither falls back. A doc page that still teaches
 * one is handing the reader code that crashes, and the crash lands on their
 * first run, which is the worst place we can put it.
 *
 * The removal shipped and the docs kept teaching the old syntax for months
 * with nothing to notice. This script is what notices.
 *
 * ## What this checks, and what it does not
 *
 * **It checks everything authored in this repo except the code that
 * implements the rejection.** The scanned surface is defined by what is
 * *excluded*, not by a list of roots that are included — see `isScannedPath`.
 * Anything a person reads, an agent copies, or a runtime executes is in.
 *
 * **It does not compile doc examples.** A quoted model string is the shape
 * that broke, and it is the shape this catches. An example can still be wrong
 * in a way no textual rule sees.
 *
 * ## The rules
 *
 * Two, because the two removed surfaces fail in different shapes and a rule
 * for one provably misses the other — a scan for `preset/` alone left
 * `apps/docs/docs/api/server.md` teaching `presets: { fast: … }`, which
 * contains no such substring.
 *
 *   "preset/small"                     a quoted model string
 *   createModelResolver({ presets: … }) the removed resolver option
 *
 * **Quoted, deliberately.** Naming `preset/*` as a rejected value is true and
 * has to stay sayable: `fundamentals/models.md` carries the migration table
 * and `custom-model-resolver.md` lists it among disallowed values. Those write
 * it in backticks or bare inside a fence. Only a quoted string reads as "call
 * this", so only a quoted string is an error.
 *
 * Exits non-zero with the offending sites and the fix. No dependencies, so CI
 * runs it without an install.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const SCAN_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|md|mdx)$/;

/**
 * Trees we did not author, plus working copies of the repo itself.
 *
 * `.docusaurus` matters as much as the rest: it caches page content as JSON
 * and TS, so a stale build of a page fixed since would report a violation
 * nobody can fix in source. `.claude` holds agent worktrees — full checkouts
 * whose files would be scanned a second time under a different path.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".docusaurus",
  ".git",
  ".claude",
  "coverage",
]);

/**
 * The rejection's own implementation. These have to name `preset/…` in quotes
 * — `parseModelString` and `createModelResolver` to reject it, their tests to
 * pin the throw, and this script to match it. Scanning them would flag the
 * rejection for existing.
 */
const REJECTION_IMPL = /^packages\/[^/]+\/(src|test)(\/|$)/;
const REJECTION_IMPL_FILES = new Set([
  "scripts/validate-model-strings.mjs",
  "packages/core/test/model-strings-check.test.ts",
]);

/**
 * Whether one repo-relative path is inside the scanned surface.
 *
 * **Defined by exclusion, deliberately.** The first version of this guard
 * enumerated the roots that were *in*, and that enumeration was wrong twice:
 * it missed `.agents` (a skill is a template an agent copies, so a stale
 * `preset/*` there keeps writing the removed syntax into new blocks) and then
 * `apps/kitchen-sink` (a reference app whose flows execute real model
 * configuration, where a bad string is a runtime throw, not a stale page).
 *
 * Two misses in one list is a property of the list. An inclusion list has to
 * be extended for every new app, package, and top-level folder, and nothing
 * fails when it isn't — the guard just quietly stops covering the new thing.
 * An exclusion list does not: anything added to this repo is scanned until
 * someone argues it out, and the argument has to be written here.
 *
 * Only two things are out, and both are the same reason: we did not author
 * it, or it is the code that implements the rejection.
 *
 * Pure and filesystem-free so the surface is testable directly.
 */
export function isScannedPath(relPath) {
  const norm = relPath.split("\\").join("/");
  if (norm === "" || norm.startsWith("..")) return false;
  if (norm.split("/").some((segment) => SKIP_DIRS.has(segment))) return false;
  if (REJECTION_IMPL.test(norm)) return false;
  if (REJECTION_IMPL_FILES.has(norm)) return false;
  return SCAN_EXTENSIONS.test(norm);
}

/**
 * A quoted `preset/<name>` model string. Backticked prose and bare text inside
 * a fence are how the migration guidance names it, and both are correct.
 */
const QUOTED_PRESET = /["']preset\/[a-zA-Z0-9_-]+["']/;

/** The removed resolver option, recognised only near a resolver construction. */
const RESOLVER_CALL = /createModelResolver\s*\(/;
const PRESETS_OPTION = /(^|[\s{,])presets\s*:/;

/**
 * How far after `createModelResolver(` a `presets:` key still reads as that
 * call's option. Long enough for the `keys` / `defaultModel` lines that
 * usually precede it, short enough not to swallow the next example.
 */
const RESOLVER_WINDOW = 15;

/**
 * Every scannable file in the repo, walking from the root.
 *
 * The walk carries no surface knowledge of its own — it prunes and selects
 * through `isScannedPath`, so what CI scans and what the test pins cannot
 * drift apart. Symlinks are neither followed nor collected (`isDirectory`
 * and `isFile` are both false for them), which keeps `.claude/skills` from
 * pulling `.agents` in a second time under another path.
 */
function collectFiles() {
  const files = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(ROOT, abs);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (REJECTION_IMPL.test(rel.split("\\").join("/"))) continue;
        walk(abs);
      } else if (entry.isFile() && isScannedPath(rel)) {
        files.push(abs);
      }
    }
  };

  walk(ROOT);
  return files;
}

/**
 * Scan in-memory sources, returning `{ file, line, text, rule }` per violation.
 *
 * Pure and filesystem-free so the rules — especially the stateful
 * `RESOLVER_WINDOW`, which no regex export can pin — are testable from fixture
 * text rather than by waiting for a red CI run on someone's PR.
 */
export function scanSources(sources) {
  const hits = [];

  for (const { path, text: body } of sources) {
    let resolverWindow = 0;

    body.split("\n").forEach((text, index) => {
      if (QUOTED_PRESET.test(text)) {
        hits.push({ file: path, line: index + 1, text: text.trim(), rule: "preset-string" });
      }

      if (RESOLVER_CALL.test(text)) resolverWindow = RESOLVER_WINDOW;

      if (resolverWindow > 0 && PRESETS_OPTION.test(text)) {
        hits.push({ file: path, line: index + 1, text: text.trim(), rule: "presets-option" });
      }

      if (resolverWindow > 0) resolverWindow -= 1;
    });
  }

  return hits;
}

/** Read one file off disk and scan it. */
function scanFile(abs) {
  return scanSources([{ path: relative(ROOT, abs), text: readFileSync(abs, "utf8") }]);
}

/** Per-rule report copy: what was found, and what to do about it. */
const RULES = [
  {
    rule: "preset-string",
    heading: (n) => `${n} quoted preset/* model string(s)`,
    fix:
      `  preset/* strings throw at runtime. Use a direct "provider/model"` +
      `\n  string, or "intent/<name>" on a resolver that declares that intent` +
      `\n  (an intent/* string with no matching intent and no defaultModel` +
      `\n  throws too). Naming preset/* as a rejected value stays fine —` +
      `\n  write it in backticks rather than quotes.`,
  },
  {
    rule: "presets-option",
    heading: (n) => `${n} use(s) of the removed 'presets' resolver option`,
    fix:
      `  createModelResolver rejects 'presets' by name. Declare 'intents'` +
      `\n  plus the required 'defaultModel' instead.`,
  },
];

function main() {
  const hits = collectFiles().flatMap(scanFile);

  if (hits.length === 0) {
    console.log("✓ No removed model-string syntax in docs or examples.");
    return;
  }

  for (const { rule, heading, fix } of RULES) {
    const matched = hits.filter((h) => h.rule === rule);
    if (matched.length === 0) continue;

    console.error(`\n✗ ${heading(matched.length)}:\n`);
    for (const hit of matched) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(`\n${fix}\n`);
  }

  process.exit(1);
}

export const resolverWindow = RESOLVER_WINDOW;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
