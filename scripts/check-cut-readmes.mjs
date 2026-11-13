#!/usr/bin/env node
/**
 * The cut READMEs: the short README each published package ships after the docs cutover, kept in
 * step with the long one it replaces until then (FIX-2698 D2).
 *
 * Until the cutover moves them into place, each published package has two READMEs: the long
 * `packages/<dir>/README.md` that npm shows today, and its cut copy at
 * `docs/contributing/docs-revamp/readmes/<dir>.md`. This holds the cut copies to their shape and
 * to the long ones:
 *
 *   shape  every published package has exactly one cut copy, and nothing else does. Each starts
 *          `# <package name>`, has an install block naming the package, exactly one example block
 *          under 20 lines, and a link to its section of the generated API reference,
 *          `https://flow-state.dev/docs/reference/api/<slug>`. The slugs are the table in
 *          `specs/epics/FIX-2696/SITEMAP/reference.md`; `contracts` has no section and links to
 *          `core`, which re-exports it.
 *   step   a change that edits a long README edits its cut copy too. A long README changes only
 *          in a release docs PR or a `docs-fix` (validate-user-docs-scope.mjs), so this fires there,
 *          and a fact fixed in one copy can't be lost at cutover.
 *
 * Once the cutover has moved the copies and removed the folder, both rules pass on nothing.
 *
 *   node scripts/check-cut-readmes.mjs [base-ref]  # shape, and step against base-ref
 *                                                  # (default: merge base with origin/main, else HEAD^1)
 *   node scripts/check-cut-readmes.mjs --exports   # the root exports only a long README clears:
 *                                                  # check-root-exports.mjs run with the cut copies in place
 *
 * Its plants are in `scripts/check-cut-readmes.test.mjs` (`node --test`).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compare, rootReport } from "./check-root-exports.mjs";
import { fsReader, overlayReader } from "./mechanism-exports.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CUT_DIR = "docs/contributing/docs-revamp/readmes";
export const SITEMAP = "specs/epics/FIX-2696/SITEMAP/reference.md";
export const REFERENCE_URL = "https://flow-state.dev/docs/reference/api/";
/** An example this many lines long or longer is not a cut README's one example. */
export const MAX_EXAMPLE_LINES = 20;

/** Published (not `private`) packages: directory under `packages/` → package name. */
export function publishedPackages(read) {
  const out = new Map();
  for (const dir of read.packageDirs()) {
    const text = read(`packages/${dir}/package.json`);
    if (!text) continue;
    const pkg = JSON.parse(text);
    if (!pkg.private) out.set(dir, pkg.name);
  }
  return out;
}

/**
 * Package name → reference slug, from the sitemap's table of generated sections. A row's first
 * cell is the slug and the first package named in its second cell owns it; `contracts` reads
 * under `core`, so it takes core's slug.
 */
export function referenceSlugs(sitemap) {
  const out = new Map();
  for (const [, slug, cell] of sitemap.matchAll(/^\|\s*`([\w-]+)`\s*\|([^|]*)\|/gm)) {
    const pkg = /`(@flow-state-dev\/[\w-]+)`/.exec(cell)?.[1];
    if (pkg) out.set(pkg, slug);
  }
  if (out.has("@flow-state-dev/core")) out.set("@flow-state-dev/contracts", out.get("@flow-state-dev/core"));
  return out;
}

/** The fenced blocks of a Markdown text: `{ lang, lines }` each. */
function fences(text) {
  const out = [];
  let open = null;
  for (const line of text.split("\n")) {
    const m = /^```(\S*)/.exec(line);
    if (m && !open) open = { lang: m[1], lines: [] };
    else if (/^```\s*$/.test(line) && open) { out.push(open); open = null; }
    else if (open) open.lines.push(line);
  }
  return out;
}

/** What is wrong with one cut README's text, for package `name` with reference slug `slug`. */
export function readmeProblems(text, name, slug) {
  const out = [];
  if (text.split("\n")[0] !== `# ${name}`) out.push(`the first line is not \`# ${name}\``);
  const blocks = fences(text);
  const isInstall = (b) => b.lines.some((l) => /\b(add|install)\b/.test(l) && l.includes(name));
  if (!blocks.some(isInstall)) out.push(`no install block names ${name}`);
  const examples = blocks.filter((b) => !isInstall(b));
  if (examples.length !== 1) out.push(`has ${examples.length} example blocks, not one`);
  for (const b of examples) {
    if (b.lines.length >= MAX_EXAMPLE_LINES) out.push(`its example is ${b.lines.length} lines; under ${MAX_EXAMPLE_LINES}`);
  }
  if (!slug) out.push(`the sitemap (${SITEMAP}) gives ${name} no reference slug`);
  else if (!text.includes(`](${REFERENCE_URL}${slug})`)) out.push(`no link to ${REFERENCE_URL}${slug}`);
  return out;
}

/** Every shape problem across the cut READMEs, as `<file>: <problem>` lines. None when the folder is gone. */
export function shapeProblems(read) {
  const files = read.list(CUT_DIR).filter((f) => f.endsWith(".md"));
  if (!files.length) return [];
  const published = publishedPackages(read);
  const slugs = referenceSlugs(read(SITEMAP) ?? "");
  const out = [];
  for (const [dir, name] of published) {
    const file = `${CUT_DIR}/${dir}.md`;
    const text = read(file);
    if (text == null) { out.push(`${file}: missing; ${name} is published and has no cut README`); continue; }
    for (const p of readmeProblems(text, name, slugs.get(name))) out.push(`${file}: ${p}`);
  }
  for (const f of files) {
    const dir = f.slice(CUT_DIR.length + 1, -3);
    if (!published.has(dir)) out.push(`${f}: no published package lives at packages/${dir}`);
  }
  return out;
}

/**
 * The long READMEs `changed` edits without their cut copy. Only a package with a cut copy at the
 * base or now counts (`hasCut`), so after cutover nothing does.
 */
export function unsyncedReadmes(changed, hasCut) {
  const touched = new Set(changed);
  return changed
    .map((f) => /^packages\/([^/]+)\/README\.md$/.exec(f)?.[1])
    .filter((dir) => dir && hasCut(dir) && !touched.has(`${CUT_DIR}/${dir}.md`))
    .map((dir) => `packages/${dir}/README.md`);
}

/**
 * The root names only a long README clears: check-root-exports.mjs's report on the tree, and on
 * the tree with each cut README in its package's place. A name that passes on the first and fails
 * on the second (named in code form by the long README alone, or reached only through such a name)
 * needs a use or leaves the root at cutover.
 */
export function readmeOnlyExports(read) {
  const overlay = {};
  for (const [dir] of publishedPackages(read)) {
    const cut = read(`${CUT_DIR}/${dir}.md`);
    if (cut != null) overlay[`packages/${dir}/README.md`] = cut;
  }
  return compare(rootReport(read), rootReport(overlayReader(read, overlay))).newFailing;
}

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function defaultBase() {
  try { return git(["merge-base", "HEAD", "origin/main"]); } catch { return "HEAD^1"; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const read = fsReader(ROOT);
  if (args.includes("--exports")) {
    const found = readmeOnlyExports(read);
    for (const { pkg, name, file } of found) console.log(`${pkg}\t${name}\t${file}`);
    console.log(`${found.length} root names only a long README clears.`);
    process.exit(0);
  }
  const base = args[0] ?? defaultBase();
  const changed = git(["diff", "--name-only", "--no-renames", base, "HEAD"]).split("\n").filter(Boolean);
  const atBase = new Set(git(["ls-tree", "--name-only", base, `${CUT_DIR}/`]).split("\n").filter(Boolean));
  const hasCut = (dir) => atBase.has(`${CUT_DIR}/${dir}.md`) || read(`${CUT_DIR}/${dir}.md`) != null;
  const shape = shapeProblems(read);
  const unsynced = unsyncedReadmes(changed, hasCut);
  for (const p of shape) console.log(p);
  for (const f of unsynced) {
    const dir = f.split("/")[1];
    console.log(`${f} changed and ${CUT_DIR}/${dir}.md did not. Until the docs cutover each published package has two READMEs; make the edit in both.`);
  }
  const ok = shape.length === 0 && unsynced.length === 0;
  console.log(ok ? `PASS: the cut READMEs hold their shape and keep step with the long ones since ${base}` : `FAIL: against ${base}`);
  process.exit(ok ? 0 : 1);
}
