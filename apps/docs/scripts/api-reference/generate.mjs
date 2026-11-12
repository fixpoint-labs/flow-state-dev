/**
 * The API reference generator: one section of Markdown per published package, rendered from
 * the doc comments in the `.d.ts` files each package publishes (FIX-2698).
 *
 * The site build calls `generateApiReference` (through `plugin.mjs`) when
 * `FSD_API_REFERENCE` is set; the output is generated at each build and never committed.
 * Before the cutover nothing generated is published: the default site build does not run
 * this, and CI's run builds into a scratch folder that is not deployed.
 *
 *   node apps/docs/scripts/api-reference/generate.mjs [--out <dir>] [--skip-types]
 *
 * Steps:
 *   1. Build every published package's types (`pnpm packages:build`, Turborepo-cached per
 *      package). `--skip-types` (or `FSD_API_REFERENCE_SKIP_TYPES=1`) skips it when the
 *      caller has just built them.
 *   2. Render each section in its own process, several at once. A section whose inputs
 *      (its own `.d.ts` files, its workspace dependencies' `.d.ts` files, and this
 *      generator) hash the same as the last run is copied from the cache instead.
 *   3. Report every export with no doc comment, counted per package. Listed, not failed on.
 *
 * Fails, naming the package, when a package cannot be read.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listSections } from "./packages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "..");
const REPO_ROOT = join(DOCS, "..", "..");
/** Where the site reads the generated Markdown from. Git-ignored. */
const DEFAULT_OUT_DIR = join(DOCS, ".api-reference");
const CACHE_DIR = join(DOCS, "node_modules", ".cache", "fsd-api-reference");
const RENDER = join(HERE, "render-package.mjs");

/** Every `.d.ts` file under `dir`, sorted, as paths relative to `dir`. */
function declarationFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".d.ts")) out.push(relative(dir, path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** The versions of the generator's own dependencies, which change its output. */
function generatorVersion() {
  const version = (name) => JSON.parse(readFileSync(join(DOCS, "node_modules", name, "package.json"), "utf8")).version;
  return [
    version("typedoc"),
    version("typedoc-plugin-markdown"),
    version("typescript"),
    readFileSync(RENDER, "utf8"),
    readFileSync(join(HERE, "packages.mjs"), "utf8"),
  ].join("\n");
}

/**
 * The cache key of one section: the generator, the section's own published declarations, and
 * those of each workspace package it depends on (a re-export, as `core` does of `contracts`,
 * renders the dependency's comments).
 */
function sectionHash(section, byName, generator) {
  const hash = createHash("sha256").update(generator).update(JSON.stringify(section.entries));
  const deps = Object.keys({ ...section.pkg.dependencies, ...section.pkg.peerDependencies })
    .filter((name) => byName.has(name))
    .sort();
  for (const dir of [section.dir, ...deps.map((name) => byName.get(name))]) {
    const dist = join(dir, "dist");
    for (const file of declarationFiles(dist)) {
      hash.update(`${relative(REPO_ROOT, dist)}/${file}\0`).update(readFileSync(join(dist, file)));
    }
  }
  return hash.digest("hex");
}

/** Every workspace package's name → its directory, private ones included (they can be dependencies). */
function workspacePackages() {
  const map = new Map();
  const packagesDir = join(REPO_ROOT, "packages");
  for (const dir of readdirSync(packagesDir)) {
    const file = join(packagesDir, dir, "package.json");
    if (existsSync(file)) map.set(JSON.parse(readFileSync(file, "utf8")).name, join(packagesDir, dir));
  }
  return map;
}

/** Runs one section's render in its own process; rejects with its message, which names the package. */
function render(job) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [RENDER, JSON.stringify(job)], { cwd: DOCS, stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(stderr.trim() || `API reference: cannot read ${job.name}: its render exited with ${code}.`)),
    );
  });
}

/**
 * Generates the API reference into `outDir`, one folder per section slug.
 *
 * @param {{ outDir?: string, skipTypes?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ outDir: string, sections: { slug: string, name: string, exports: number, undocumented: string[], cached: boolean }[] }>}
 */
export async function generateApiReference({ outDir = DEFAULT_OUT_DIR, skipTypes = false, log = console.log } = {}) {
  const started = Date.now();
  if (!skipTypes) {
    log("[api-reference] building the published packages' types (pnpm packages:build)");
    execFileSync("pnpm", ["packages:build"], { cwd: REPO_ROOT, stdio: "inherit" });
  }
  const typesDone = Date.now();

  const sections = listSections(REPO_ROOT);
  const byName = workspacePackages();
  const generator = generatorVersion();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const results = [];
  const queue = [...sections];
  const worker = async () => {
    for (let section = queue.shift(); section; section = queue.shift()) {
      const key = sectionHash(section, byName, generator);
      const entry = join(CACHE_DIR, section.slug);
      const job = {
        name: section.pkg.name,
        dir: section.dir,
        entries: section.entries,
        out: join(entry, "out"),
        report: join(entry, "report.json"),
      };
      const keyFile = join(entry, "key");
      const cached = existsSync(keyFile) && readFileSync(keyFile, "utf8") === key && existsSync(job.report);
      if (!cached) {
        rmSync(keyFile, { force: true });
        await render(job);
        writeFileSync(keyFile, key);
      }
      cpSync(job.out, join(outDir, section.slug), { recursive: true });
      const report = JSON.parse(readFileSync(job.report, "utf8"));
      results.push({ slug: section.slug, name: report.name, exports: report.exports, undocumented: report.undocumented, unlinked: report.unlinked, cached });
    }
  };
  const width = Math.max(1, Math.min(availableParallelism(), 4, sections.length));
  await Promise.all(Array.from({ length: width }, worker));
  results.sort((a, b) => sections.findIndex((s) => s.slug === a.slug) - sections.findIndex((s) => s.slug === b.slug));

  const undocumented = results.reduce((n, r) => n + r.undocumented.length, 0);
  const exportsTotal = results.reduce((n, r) => n + r.exports, 0);
  writeFileSync(
    join(CACHE_DIR, "undocumented.json"),
    JSON.stringify(Object.fromEntries(results.map((r) => [r.name, r.undocumented])), null, 2),
  );
  log(
    `[api-reference] ${results.length} sections, ${exportsTotal} exports, ${undocumented} without a doc comment ` +
      `(${results.filter((r) => r.cached).length} sections from cache) · types ${((typesDone - started) / 1000).toFixed(1)}s · ` +
      `render ${((Date.now() - typesDone) / 1000).toFixed(1)}s`,
  );
  for (const r of results) {
    if (r.undocumented.length > 0) log(`[api-reference]   ${r.name}: ${r.undocumented.length} of ${r.exports} exports have no doc comment`);
    if (r.unlinked.length > 0) log(`[api-reference]   ${r.name}: ${r.unlinked.length} comment links to an anchor the page lacks, left as text`);
  }
  log(`[api-reference] the list: ${relative(REPO_ROOT, join(CACHE_DIR, "undocumented.json"))}`);
  return { outDir, sections: results };
}

// No top-level await: the site config loads this file through jiti, which compiles it to CommonJS.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  generateApiReference({
    outDir: outAt >= 0 ? args[outAt + 1] : DEFAULT_OUT_DIR,
    skipTypes: args.includes("--skip-types") || process.env.FSD_API_REFERENCE_SKIP_TYPES === "1",
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
