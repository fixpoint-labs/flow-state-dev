#!/usr/bin/env node
/**
 * Adds the file extension Node's ESM resolver requires to the relative
 * specifiers in a package's build output.
 *
 * The workspace compiles with `moduleResolution: "Bundler"`, which lets source
 * write `./items/predicates` and lets `tsc` emit that specifier verbatim. In the
 * repo nothing notices, because every package resolves through `src/*.ts` and a
 * bundler-style resolver. Published, the same line is fatal: packages are
 * `"type": "module"`, and Node refuses an extensionless relative specifier with
 * `ERR_MODULE_NOT_FOUND`. Only a consumer installing from npm ever runs that
 * path, which is how 0.1.1 shipped broken.
 *
 * This rewrites `./items/predicates` to `./items/predicates.js`, and a directory
 * specifier to its `/index.js`, in the emitted `.js` and `.d.ts` files.
 *
 * **Bare specifiers are never touched.** `@flow-state-dev/contracts/helpers` and
 * `zod` must stay exactly as written so npm resolves the real dependency. This
 * is not a detail: `tsc-alias --resolve-full-paths` was tried first and inlined
 * the workspace `paths` map, turning a cross-package import into a relative path
 * that pointed at the importing file itself — a silent circular no-op export.
 * Rewriting only what already starts with `./` or `../` is what makes this safe.
 *
 * A specifier that resolves to no file on disk is left exactly as written,
 * since guessing at it would trade a loud failure for a quiet one.
 *
 * Write mode is not a verifier: a specifier it cannot resolve is left as it is
 * and it still exits 0, so a build script keeps going. It fails only when a
 * directory it was pointed at holds no output at all, which is the shape a
 * silently-skipped build step takes.
 *
 * `--check` is the verifier. It rewrites nothing and exits non-zero if any
 * specifier still needs extending.
 * CI runs it over every publishable `dist` after the build, so dropping this
 * step from a package's `build` script is a red check rather than another
 * broken release. No dependencies.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

/** Extensions a specifier may already carry; these are left untouched. */
const SETTLED = /\.(js|mjs|cjs|json|node|css)$/;

/**
 * Every place a module specifier can appear in emitted JavaScript or a
 * declaration file: static `from`, a side-effect `import`, and dynamic
 * `import()`. Captured in three parts so the quote style is preserved.
 */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.[^"']*)\2/g;

/**
 * Decide what a relative specifier should become, given the file it appears in.
 *
 * Returns the rewritten specifier, or `null` to leave it alone — either because
 * it already carries an extension or because nothing on disk matches it.
 *
 * Exported so a test can drive every branch against fixtures.
 *
 * @param {string} spec — the specifier as written, e.g. `./items/predicates`.
 * @param {string} fromDir — directory of the file containing it.
 * @param {string} ext — the extension to add: `.js` or `.d.ts`.
 * @param {(p: string) => boolean} isFile — file-existence probe.
 * @param {(p: string) => boolean} isDir — directory-existence probe.
 */
export function rewriteSpecifier(spec, fromDir, ext, isFile, isDir) {
  if (SETTLED.test(spec)) return null;
  const target = resolvePath(fromDir, spec);
  // A declaration file's sibling is `foo.d.ts`, but the specifier it emits must
  // still read `foo.js` — TypeScript maps the one to the other.
  const probe = ext === ".d.ts" ? ".d.ts" : ".js";
  if (isFile(target + probe)) return `${spec}.js`;
  if (isDir(target) && isFile(join(target, `index${probe}`)))
    return `${spec}/index.js`;
  return null;
}

/** Rewrite one file's contents. Returns the new text and how many changed. */
export function rewriteSource(text, fromDir, ext, isFile, isDir) {
  let count = 0;
  const out = text.replace(SPECIFIER, (whole, head, quote, spec) => {
    const next = rewriteSpecifier(spec, fromDir, ext, isFile, isDir);
    if (next === null) return whole;
    count += 1;
    return `${head}${quote}${next}${quote}`;
  });
  return { text: out, count };
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

/**
 * True when a `dist` belongs to a package that is never published.
 *
 * Only npm consumers ever run this output, so a private package's `dist` is
 * irrelevant here — it is built for the repo, which resolves through `src`.
 * Letting a glob like `packages/*\/dist` include them would make the check fail
 * on output nobody installs.
 */
export function isPrivateDist(dir, read) {
  try {
    return read(join(dirname(dir), "package.json")).private === true;
  } catch {
    return false;
  }
}

const readManifest = (p) => JSON.parse(readFileSync(p, "utf8"));

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))
      out.push(full);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const dirs = args.filter((a) => a !== "--check");
  if (dirs.length === 0) {
    console.error("usage: add-esm-extensions.mjs [--check] <dist-dir> [...]");
    process.exit(1);
  }

  let files = 0;
  let rewritten = 0;
  const offenders = [];
  for (const dir of dirs) {
    if (isPrivateDist(dir, readManifest)) continue;
    for (const file of walk(dir)) {
      const ext = file.endsWith(".d.ts") ? ".d.ts" : ".js";
      const text = readFileSync(file, "utf8");
      const result = rewriteSource(text, dirname(file), ext, isFile, isDir);
      files += 1;
      if (result.count === 0) continue;
      if (check) offenders.push({ file, count: result.count });
      else {
        writeFileSync(file, result.text);
        rewritten += result.count;
      }
    }
  }

  if (files === 0) {
    console.error(`✗ no .js or .d.ts output found under: ${dirs.join(", ")}`);
    process.exit(1);
  }

  if (!check) {
    console.log(`✓ ${rewritten} specifier(s) extended across ${files} file(s)`);
    process.exit(0);
  }

  if (offenders.length === 0) {
    console.log(
      `✓ ${files} built file(s) carry the extensions Node's ESM resolver needs`,
    );
    process.exit(0);
  }

  console.error(
    `\n✗ ${offenders.length} built file(s) hold a relative import Node cannot resolve:\n`,
  );
  for (const { file, count } of offenders)
    console.error(`    ${file}  (${count})`);
  console.error(
    `\n  These publish as-is and fail on import with ERR_MODULE_NOT_FOUND.` +
      `\n  The package's build must run scripts/add-esm-extensions.mjs after tsc;` +
      `\n  check that its "build" script still does.\n`,
  );
  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
