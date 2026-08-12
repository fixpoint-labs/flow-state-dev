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
 * **It checks prose and examples, not the runtime that implements the
 * rejection.** Package `src` and `test` trees are deliberately outside the
 * scanned surface: the migration error message and the tests that pin it have
 * to name `preset/…` in quotes, and that is the code being correct, not a
 * regression.
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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Documentation and example surfaces. Package `src`/`test` are excluded on
 * purpose — see the header. Package READMEs are in, because they are docs.
 */
const SCAN_ROOTS = ["apps/docs", "docs", "examples", "labs"];

/** Root-level docs and package READMEs, which no tree above reaches. */
const SCAN_FILES = ["README.md"];

const SCAN_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|md|mdx)$/;
/**
 * Generated trees. `.docusaurus` matters as much as the rest: it caches page
 * content as JSON and TS, so a stale build of a page fixed since would report
 * a violation nobody can fix in source.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".docusaurus",
  "coverage",
]);

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

/** Collect every scannable file under the configured roots. */
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
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (SCAN_EXTENSIONS.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  };

  for (const root of SCAN_ROOTS) walk(join(ROOT, root));

  for (const file of SCAN_FILES) {
    const abs = join(ROOT, file);
    try {
      if (statSync(abs).isFile()) files.push(abs);
    } catch {
      /* absent is fine */
    }
  }

  // Package READMEs are documentation; their src/test siblings are not scanned.
  const packagesDir = join(ROOT, "packages");
  let pkgs;
  try {
    pkgs = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    pkgs = [];
  }
  for (const pkg of pkgs) {
    if (!pkg.isDirectory()) continue;
    const readme = join(packagesDir, pkg.name, "README.md");
    try {
      if (statSync(readme).isFile()) files.push(readme);
    } catch {
      /* absent is fine */
    }
  }

  return files;
}

/** Scan one file, returning `{ file, line, text, rule }` for each violation. */
function scanFile(abs) {
  const rel = relative(ROOT, abs);
  const lines = readFileSync(abs, "utf8").split("\n");
  const hits = [];

  let resolverWindow = 0;

  lines.forEach((text, index) => {
    if (QUOTED_PRESET.test(text)) {
      hits.push({ file: rel, line: index + 1, text: text.trim(), rule: "preset-string" });
    }

    if (RESOLVER_CALL.test(text)) resolverWindow = RESOLVER_WINDOW;

    if (resolverWindow > 0 && PRESETS_OPTION.test(text)) {
      hits.push({ file: rel, line: index + 1, text: text.trim(), rule: "presets-option" });
    }

    if (resolverWindow > 0) resolverWindow -= 1;
  });

  return hits;
}

function main() {
  const hits = collectFiles().flatMap(scanFile);

  if (hits.length === 0) {
    console.log("✓ No removed model-string syntax in docs or examples.");
    return;
  }

  const presetStrings = hits.filter((h) => h.rule === "preset-string");
  const presetsOptions = hits.filter((h) => h.rule === "presets-option");

  if (presetStrings.length > 0) {
    console.error(`\n✗ ${presetStrings.length} quoted preset/* model string(s):\n`);
    for (const hit of presetStrings) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(
      `\n  preset/* strings throw at runtime. Use a direct "provider/model"` +
        `\n  string, or "intent/<name>" on a resolver that declares that intent` +
        `\n  (an intent/* string with no matching intent and no defaultModel` +
        `\n  throws too). Naming preset/* as a rejected value stays fine —` +
        `\n  write it in backticks rather than quotes.\n`,
    );
  }

  if (presetsOptions.length > 0) {
    console.error(`\n✗ ${presetsOptions.length} use(s) of the removed 'presets' resolver option:\n`);
    for (const hit of presetsOptions) console.error(`    ${hit.file}:${hit.line}  →  ${hit.text}`);
    console.error(
      `\n  createModelResolver rejects 'presets' by name. Declare 'intents'` +
        `\n  plus the required 'defaultModel' instead.\n`,
    );
  }

  process.exit(1);
}

/** The scanned surface, exported so a test can assert it still reaches the docs. */
export const scanRoots = SCAN_ROOTS;
export const scanFiles = SCAN_FILES;

/** The rules, exported so a test can assert each still matches its shape. */
export const quotedPresetPattern = QUOTED_PRESET;
export const presetsOptionPattern = PRESETS_OPTION;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
