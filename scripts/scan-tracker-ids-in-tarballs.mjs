#!/usr/bin/env node
/**
 * The tarball scan: what an adopter reads once FSD is installed, for the
 * tracker-id goal (no tracker or process id in a hover, an error, a log line or
 * a test title). The lint (`eslint-rules/no-tracker-ids.mjs`) gates the source;
 * this reads the packed output, so a disabled line, a suppression or a file
 * shipped from outside the lint's file set still shows.
 *
 * For each package it reports the rule's pattern ({@link TRACKER_ID}, imported,
 * never copied) in:
 *
 * - hovers: `/**` and `/*!` blocks in `.d.ts` files;
 * - runtime text: string and template literals in `.js` files;
 * - code shipped from outside the file set: a `.js` or `.d.ts` file outside
 *   `dist/` and `dist-client/` (built from linted roots) whose root the lint
 *   does not name.
 *
 * A `//` comment in compiled `.js` is a kept pointer (BP-006) and not read.
 *
 *   node scripts/scan-tracker-ids-in-tarballs.mjs --all             # pack every published package (after `pnpm release:build`)
 *   node scripts/scan-tracker-ids-in-tarballs.mjs <file.tgz|dir>...  # tarballs or unpacked package dirs
 *
 * Exits 1 when any package shows an id or ships code from outside the set.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SHIPPED_SOURCE, TRACKER_ID } from "./eslint-rules/no-tracker-ids.mjs";
import { packAll } from "./packed-install/run.mjs";

const ts = createRequire(import.meta.url)("typescript");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IDS = new RegExp(TRACKER_ID.source, "g");
const DTS = /\.d\.[mc]?ts$/;
const JS = /\.[mc]?js$/;

/** Output directories built from linted roots (`src`, shift-manager's `cli`, `apps/devtool/src`). */
const BUILT = new Set(["dist", "dist-client"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Each id in `text`, as `{ id, file }`. */
const idsIn = (text, file) => [...text.matchAll(IDS)].map((m) => ({ id: m[0], file }));

/** JSDoc ids in a `.d.ts`: tsc copies JSDoc, and only JSDoc, into one. */
function hoversIn(text, file) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const found = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const token = scanner.getTokenText();
    if (kind === ts.SyntaxKind.MultiLineCommentTrivia && /^\/\*[*!]/.test(token)) found.push(...idsIn(token, file));
  }
  return found;
}

/** Ids in a `.js` file's string and template literals. */
function runtimeTextIn(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) found.push(...idsIn(node.text, file));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The roots outside `src` the lint names for `packages/<workspaceDir>`. */
function lintedRoots(workspaceDir) {
  const prefix = `packages/${workspaceDir}/`;
  return new Set(SHIPPED_SOURCE.files.filter((g) => g.startsWith(prefix)).map((g) => g.slice(prefix.length).split("/")[0]));
}

/**
 * Scan one unpacked package.
 *
 * @param {string} dir — the unpacked package (the tarball's `package/`).
 * @param {string} workspaceDir — its directory under `packages/`.
 * @returns {{ hovers: { id: string, file: string }[], runtimeText: { id: string, file: string }[], outside: string[] }}
 */
export function scanPackage(dir, workspaceDir) {
  const roots = lintedRoots(workspaceDir);
  const result = { hovers: [], runtimeText: [], outside: [] };
  for (const path of walk(dir)) {
    const file = relative(dir, path);
    const code = DTS.test(file) || JS.test(file);
    if (!code) continue;
    const top = file.split("/")[0];
    if (!BUILT.has(top) && !roots.has(top)) result.outside.push(file);
    const text = readFileSync(path, "utf8");
    if (DTS.test(file)) result.hovers.push(...hoversIn(text, file));
    else result.runtimeText.push(...runtimeTextIn(text, file));
  }
  return result;
}

/** The workspace directory under `packages/` for each published package name. */
function workspaceDirs() {
  const dirs = new Map();
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    try {
      dirs.set(JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")).name, dir);
    } catch {
      // Not a package directory.
    }
  }
  return dirs;
}

function main(args) {
  const work = mkdtempSync(join(tmpdir(), "tracker-id-scan-"));
  try {
    let inputs = args.filter((a) => !a.startsWith("--"));
    if (args.includes("--all")) inputs = packAll(work).map((p) => p.tarball);
    if (inputs.length === 0) {
      console.error("usage: scan-tracker-ids-in-tarballs.mjs --all | <file.tgz|dir>...");
      return 2;
    }
    const dirs = workspaceDirs();
    let bad = 0;
    for (const input of inputs) {
      let dir = input;
      if (input.endsWith(".tgz")) {
        dir = mkdtempSync(join(work, "pkg-"));
        const res = spawnSync("tar", ["xzf", input, "-C", dir], { encoding: "utf8" });
        if (res.status !== 0) throw new Error(`tar could not unpack ${input}: ${res.stderr}`);
        dir = join(dir, "package");
      }
      const name = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name;
      const { hovers, runtimeText, outside } = scanPackage(dir, dirs.get(name) ?? name.split("/").pop());
      const line = `${name}: ${hovers.length} in hovers, ${runtimeText.length} in runtime text, ${outside.length} file(s) from outside the lint's set`;
      const found = hovers.length + runtimeText.length + outside.length;
      bad += found ? 1 : 0;
      console.log(`${found ? "✗" : "✓"} ${line}`);
      for (const h of hovers) console.log(`    hover ${h.id}  ${h.file}`);
      for (const h of runtimeText) console.log(`    runtime text ${h.id}  ${h.file}`);
      for (const f of outside) console.log(`    shipped from outside the lint's file set  ${f}`);
    }
    console.log(bad ? `FAIL: ${bad} package(s) show a tracker id to an adopter` : `PASS: ${inputs.length} package(s), no tracker ids`);
    return bad ? 1 : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
