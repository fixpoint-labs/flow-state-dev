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
 * `--check` is the verifier. It rewrites nothing and exits non-zero when a
 * specifier still needs extending, when a relative import matches no file at
 * all, or when a publishable package produced no output. CI runs it as
 * `--check --all` after the build, so dropping this step from a package's
 * `build` script is a red check rather than another broken release.
 *
 * Doc comments and string literals are not code and are never touched: an
 * `@example` showing the consumer's own `./flow-state` import is prose.
 *
 * No dependencies.
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

/**
 * True for each character position that sits inside a comment or a string.
 *
 * Emitted output carries JSDoc, and JSDoc carries `@example` blocks with
 * imports in them — `import { flowState } from "./flow-state"` in
 * `@flow-state-dev/node` is documentation, not a module Node will ever load.
 * Rewriting it would edit prose, and reporting it would be a false failure, so
 * the scan skips anything that is not real code. Strings are masked for the
 * same reason: a specifier is only a specifier where the parser would see one.
 *
 * A character-level pass rather than a parser, because this script takes no
 * dependencies and only needs to know code from not-code.
 *
 * @param {string} text — the file's contents.
 * @returns {Uint8Array} — 1 where the position is masked.
 */
export function maskedPositions(text) {
  const mask = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      mask.fill(1, i, stop);
      i = stop;
    } else if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      mask.fill(1, i, stop);
      i = stop;
    } else if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\") j += 1;
        j += 1;
      }
      // The string's interior is masked, not its opening quote: a match is
      // anchored at the `from` / `import` head, which is code, so a real
      // specifier still rewrites while `"... from './x'"` inside a string
      // literal does not.
      mask.fill(1, i + 1, Math.min(j, text.length));
      i = j + 1;
    } else i += 1;
  }
  return mask;
}

/**
 * Rewrite one file's contents.
 *
 * Returns the new text, how many specifiers changed, and the relative
 * specifiers that carry no extension and match nothing on disk. That third
 * list matters because `rewriteSpecifier` returns `null` for two opposite
 * cases — already settled, and unresolvable — and only the first is harmless.
 * Without it, `./nowhere` in emitted output passes `--check` and then throws
 * `ERR_MODULE_NOT_FOUND` on the consumer's machine, which is the exact failure
 * this script exists to prevent.
 */
export function rewriteSource(text, fromDir, ext, isFile, isDir) {
  let count = 0;
  const unresolved = [];
  const masked = maskedPositions(text);
  const out = text.replace(SPECIFIER, (whole, head, quote, spec, offset) => {
    if (masked[offset] === 1) return whole;
    const next = rewriteSpecifier(spec, fromDir, ext, isFile, isDir);
    if (next === null) {
      if (!SETTLED.test(spec)) unresolved.push(spec);
      return whole;
    }
    count += 1;
    return `${head}${quote}${next}${quote}`;
  });
  return { text: out, count, unresolved };
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

/**
 * The `dist` directory of every publishable package under `packages/`.
 *
 * Discovery rather than a shell glob, because a glob cannot report what is
 * missing: if a package stops emitting `dist` entirely, `packages/*\/dist`
 * quietly expands to one fewer path and the check passes without ever looking
 * at that package. Asking the workspace which packages publish, and then
 * demanding output from each, turns that silence into a failure.
 *
 * Exported so a test can drive it against fixtures.
 *
 * @param {string[]} dirs — directory names under `packages/`.
 * @param {(dir: string) => { private?: boolean }} read — manifest reader.
 */
export function publishableDists(dirs, read) {
  const out = [];
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = read(dir);
    } catch {
      continue;
    }
    if (manifest.private !== true) out.push(dir);
  }
  return out;
}

const PACKAGES = new URL("../packages", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

/** Every publishable package's `dist` path, read from the workspace itself. */
function discoverDists() {
  const dirs = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  return publishableDists(dirs, (dir) =>
    readManifest(join(PACKAGES, dir, "package.json")),
  ).map((dir) => join(PACKAGES, dir, "dist"));
}

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
  const all = args.includes("--all");
  const named = args.filter((a) => a !== "--check" && a !== "--all");
  if (named.length === 0 && !all) {
    console.error(
      "usage: add-esm-extensions.mjs [--check] (--all | <dist-dir> [...])",
    );
    process.exit(1);
  }
  // `--all` is the CI shape: the script decides which packages must have output,
  // so a package that emits nothing is a failure rather than an absent argument.
  const dirs = all ? discoverDists() : named;

  let files = 0;
  let rewritten = 0;
  const offenders = [];
  const broken = [];
  const empty = [];
  for (const dir of dirs) {
    if (isPrivateDist(dir, readManifest)) continue;
    const found = walk(dir);
    if (found.length === 0) {
      empty.push(dir);
      continue;
    }
    for (const file of found) {
      const ext = file.endsWith(".d.ts") ? ".d.ts" : ".js";
      const text = readFileSync(file, "utf8");
      const result = rewriteSource(text, dirname(file), ext, isFile, isDir);
      files += 1;
      for (const spec of result.unresolved) broken.push({ file, spec });
      if (result.count === 0) continue;
      if (check) offenders.push({ file, count: result.count });
      else {
        writeFileSync(file, result.text);
        rewritten += result.count;
      }
    }
  }

  // Checked per directory, not once over the total: a package that emits
  // nothing is invisible in an aggregate count that its siblings keep non-zero.
  if (empty.length > 0) {
    console.error(`\n✗ ${empty.length} package(s) produced no build output:\n`);
    for (const dir of empty) console.error(`    ${dir}`);
    console.error(
      `\n  A publishable package with no dist publishes an empty tarball.` +
        `\n  Run the build before this check.\n`,
    );
    process.exit(1);
  }

  if (!check) {
    console.log(`✓ ${rewritten} specifier(s) extended across ${files} file(s)`);
    if (broken.length > 0)
      console.warn(
        `  note: ${broken.length} relative import(s) match no file; --check fails on these`,
      );
    process.exit(0);
  }

  if (offenders.length === 0 && broken.length === 0) {
    console.log(
      `✓ ${files} built file(s) carry the extensions Node's ESM resolver needs`,
    );
    process.exit(0);
  }

  if (offenders.length > 0) {
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
  }

  if (broken.length > 0) {
    console.error(
      `\n✗ ${broken.length} relative import(s) match no file on disk:\n`,
    );
    for (const { file, spec } of broken) console.error(`    ${file}  →  ${spec}`);
    console.error(
      `\n  Adding an extension cannot fix these — there is nothing to point at.` +
        `\n  They fail on import with ERR_MODULE_NOT_FOUND just the same.\n`,
    );
  }

  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
