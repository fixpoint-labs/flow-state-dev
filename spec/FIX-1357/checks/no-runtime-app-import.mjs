#!/usr/bin/env node
/**
 * FIX-1357 · the spec's factual base, as a check (issue-spec Step 5, BP-003).
 *
 * D1 rests on one claim: **the framework never imports app code at run time.**
 * Only the toolchain (`packages/cli`) does, which is why a discovery step that
 * imports what it found has to live there rather than in `hireWorkforce`.
 *
 * Asserting that in prose is what this replaces. The check classifies EVERY
 * `import(` in every shipped package source into exactly one bucket and fails
 * on anything it cannot classify — a totality assertion, so a call nobody
 * listed still reports.
 *
 *   static     — the argument is a literal specifier. A bundler resolves it.
 *   toolchain  — a computed argument under `packages/cli/`. Allowed: the CLI
 *                runs from source on a developer's machine, never bundled.
 *   pkg-probe  — a computed argument that still names an INSTALLED PACKAGE: a
 *                module-scope constant, or a `node_modules` resolution of one.
 *                Allowed per file and per expression, never pattern-matched,
 *                because the distinguishing property is that the framework can
 *                name the subject — not that the call is dynamic.
 *   UNCLASSIFIED — anything else. That is a framework runtime import of a path
 *                  something outside the package chose, and it fails this check.
 *
 * The line D1 draws is therefore not "no dynamic import". It is: the framework
 * imports specifiers it can NAME, never paths it DISCOVERED by walking the
 * app's tree. A scan-then-import belongs on the far side of that line.
 *
 * Run:  node spec/FIX-1357/checks/no-runtime-app-import.mjs
 * Negative control: add `await import(somePath)` to any packages/<p>/src file
 * outside packages/cli and re-run. It must report UNCLASSIFIED and exit 1.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const PACKAGES = join(ROOT, "packages");

/**
 * Computed `import()` arguments that still name an installed package. Listed by
 * file AND by the expression that opens the argument, so a second computed
 * import in the same file — or the same file switching to an app-chosen path —
 * still reports.
 */
const PACKAGE_PROBES = new Map([
  ["packages/claude-code/src/sdk/sdk-client.ts", "SDK_MODULE"],
  ["packages/codex/src/codex-client.ts", "SDK_MODULE"],
  ["packages/cursor/src/cursor-client.ts", "SDK_MODULE"],
  // `pathToFileURL(tryResolveModulePath(packageName))` — a provider package
  // resolved out of node_modules, bundler-ignored so Node resolves it at run
  // time. The subject is still a package name the framework was handed.
  ["packages/core/src/models/createModelResolver.ts", "pathToFileURL"],
]);

const SOURCE = /\.(ts|tsx|mts)$/;
const TEST = /\.(test|spec)\.(ts|tsx|mts)$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "test") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (SOURCE.test(entry) && !TEST.test(entry)) yield full;
  }
}

function sources() {
  const out = [];
  for (const pkg of readdirSync(PACKAGES)) {
    const src = join(PACKAGES, pkg, "src");
    try {
      if (statSync(src).isDirectory()) out.push(...walk(src));
    } catch {
      /* a package with no src/ */
    }
  }
  return out;
}

/** The first non-comment, non-space token after `import(`. */
function argumentOf(text, open) {
  let i = open;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i);
      if (end === -1) return text.slice(i);
      i = end + 2;
      continue;
    }
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      if (end === -1) return "";
      i = end + 1;
      continue;
    }
    break;
  }
  return text.slice(i, i + 200);
}

/**
 * Blank out comments and string bodies, keeping every byte offset, so prose
 * mentioning `import()` in a doc comment is not counted as a call. Length is
 * preserved on purpose: offsets still address the original text.
 */
function blankNonCode(text) {
  const out = text.split("");
  let i = 0;
  const hide = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      hide(i, stop);
      i = stop;
      continue;
    }
    if (two === "//") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      hide(i, stop);
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch) break;
        j += 1;
      }
      // The quotes stay; only the body is blanked, so a literal argument is
      // still recognisable as one.
      hide(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

const buckets = { static: 0, toolchain: 0, "pkg-probe": 0 };
const unclassified = [];
let total = 0;

for (const file of sources()) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const raw = readFileSync(file, "utf8");
  const text = blankNonCode(raw);
  const pattern = /\bimport\s*\(/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // `.import(` is a method call, not the import expression.
    if (/[.\w$]/.test(text[match.index - 1] ?? "")) continue;
    total += 1;
    const from = match.index + match[0].length;
    const arg = argumentOf(text, from);
    const rawArg = argumentOf(raw, from);
    const line = text.slice(0, match.index).split("\n").length;

    // A template literal counts as static only when it interpolates nothing;
    // read that off the RAW text, since the blanked copy has lost the `${`.
    const literal =
      arg.startsWith('"') ||
      arg.startsWith("'") ||
      (arg.startsWith("`") && !rawArg.slice(0, Math.max(rawArg.indexOf("`", 1), 1)).includes("${"));
    if (literal) { buckets.static += 1; continue; }

    if (rel.startsWith("packages/cli/")) { buckets.toolchain += 1; continue; }

    const probe = PACKAGE_PROBES.get(rel);
    if (probe !== undefined && arg.startsWith(probe)) { buckets["pkg-probe"] += 1; continue; }

    unclassified.push(`${rel}:${line}  import(${arg.split("\n")[0].slice(0, 60)}`);
  }
}

const classified = buckets.static + buckets.toolchain + buckets["pkg-probe"] + unclassified.length;

console.log(`import() expressions in packages/*/src (excluding tests): ${total}`);
console.log(`  static (literal specifier)        ${buckets.static}`);
console.log(`  toolchain (packages/cli)          ${buckets.toolchain}`);
console.log(`  pkg-probe (still names a package)  ${buckets["pkg-probe"]}`);
console.log(`  UNCLASSIFIED                      ${unclassified.length}`);

if (classified !== total) {
  console.error(`\nFAIL · totality: ${classified} classified of ${total}. The buckets do not cover the corpus.`);
  process.exit(1);
}

if (unclassified.length > 0) {
  console.error("\nFAIL · a shipped package imports a path it did not choose at run time:");
  for (const entry of unclassified) console.error(`  ${entry}`);
  console.error("\nD1 says discovery-then-import lives in the toolchain. Move it, or change D1.");
  process.exit(1);
}

console.log("\nPASS · outside packages/cli, every import() names a fixed specifier.");
