/**
 * The API reference generator: one section of Markdown per published package, rendered from
 * the doc comments in the `.d.ts` files each package publishes.
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
 *      (its own `.d.ts` files, those of every workspace package it reaches through its
 *      dependencies, and this generator) hash the same as the last run is copied from the
 *      cache instead.
 *   3. Report, per package, every export with no doc comment and every warning TypeDoc
 *      logged (a broken `{@link}`, say). Listed, not failed on.
 *
 * Fails, naming the package, when a package cannot be read; the first failure stops any
 * further section from starting.
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
    // TypeDoc 0.28 loads TypeScript's JS API, which its peer range caps at 6.0.x, so the docs
    // app is given TypeScript 6; when the repo's TypeScript moves on, move TypeDoc to a release
    // whose peer range covers the new one before dropping 6.
    version("typescript"),
    readFileSync(RENDER, "utf8"),
    readFileSync(join(HERE, "packages.mjs"), "utf8"),
  ].join("\n");
}

/**
 * Builds the cache key of each section: the generator, the section's own published
 * declarations, and those of every workspace package it reaches through `dependencies` and
 * `peerDependencies`, however many hops away. TypeDoc renders a re-exported symbol's comment
 * from the package that declares it, so `workforce` → `orchestration` → `core` puts `core`'s
 * comments on `workforce`'s page. Each package's declarations are hashed once per run.
 *
 * @param {Map<string, { dir: string, pkg: Record<string, any> }>} byName
 * @param {string} generator
 */
function sectionKeys(byName, generator) {
  const digests = new Map();
  const digestOf = (dir) => {
    if (!digests.has(dir)) {
      const hash = createHash("sha256");
      const dist = join(dir, "dist");
      for (const file of declarationFiles(dist)) hash.update(`${file}\0`).update(readFileSync(join(dist, file)));
      digests.set(dir, hash.digest("hex"));
    }
    return digests.get(dir);
  };
  /** The workspace packages `pkg` reaches, itself excluded. */
  const closure = (pkg) => {
    const seen = new Set();
    const visit = (p) => {
      for (const name of Object.keys({ ...p.dependencies, ...p.peerDependencies })) {
        if (seen.has(name) || !byName.has(name)) continue;
        seen.add(name);
        visit(byName.get(name).pkg);
      }
    };
    visit(pkg);
    seen.delete(pkg.name);
    return [...seen].sort();
  };
  return (section) => {
    const hash = createHash("sha256").update(generator).update(JSON.stringify(section.entries));
    hash.update(`${section.pkg.name}\0${digestOf(section.dir)}\0`);
    for (const name of closure(section.pkg)) hash.update(`${name}\0${digestOf(byName.get(name).dir)}\0`);
    return hash.digest("hex");
  };
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
 * `root` and `cacheDir` default to this repository and the docs app's cache; a test points
 * them at a scratch workspace.
 *
 * @param {{ outDir?: string, skipTypes?: boolean, log?: (line: string) => void, root?: string, cacheDir?: string }} [options]
 * @returns {Promise<{ outDir: string, sections: { slug: string, name: string, exports: number, undocumented: string[], unlinked: string[], warnings: string[], cached: boolean }[] }>}
 */
export async function generateApiReference({
  outDir = DEFAULT_OUT_DIR,
  skipTypes = false,
  log = console.log,
  root = REPO_ROOT,
  cacheDir = CACHE_DIR,
} = {}) {
  const started = Date.now();
  if (!skipTypes) {
    log("[api-reference] building the published packages' types (pnpm packages:build)");
    execFileSync("pnpm", ["packages:build"], { cwd: root, stdio: "inherit" });
  }
  const typesDone = Date.now();

  const { sections, byName } = listSections(root);
  const keyOf = sectionKeys(byName, generatorVersion());
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const results = [];
  const queue = [...sections];
  const renderNext = async (section) => {
    const key = keyOf(section);
    const entry = join(cacheDir, section.slug);
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
    results.push({ slug: section.slug, ...report, cached });
  };
  const worker = async () => {
    for (let section = queue.shift(); section; section = queue.shift()) {
      try {
        await renderNext(section);
      } catch (error) {
        // The build has failed: start nothing more, so it fails in seconds, not after every
        // remaining section has rendered.
        queue.length = 0;
        throw error;
      }
    }
  };
  const width = Math.max(1, Math.min(availableParallelism(), 4, sections.length));
  await Promise.all(Array.from({ length: width }, worker));
  results.sort((a, b) => sections.findIndex((s) => s.slug === a.slug) - sections.findIndex((s) => s.slug === b.slug));

  const total = (field) => results.reduce((n, r) => n + r[field].length, 0);
  const exportsTotal = results.reduce((n, r) => n + r.exports, 0);
  const reportFile = join(cacheDir, "report.json");
  writeFileSync(
    reportFile,
    JSON.stringify(Object.fromEntries(results.map((r) => [r.name, { undocumented: r.undocumented, warnings: r.warnings }])), null, 2),
  );
  log(
    `[api-reference] ${results.length} sections, ${exportsTotal} exports, ${total("undocumented")} without a doc comment, ` +
      `${total("warnings")} TypeDoc warnings (${results.filter((r) => r.cached).length} sections from cache) · ` +
      `types ${((typesDone - started) / 1000).toFixed(1)}s · render ${((Date.now() - typesDone) / 1000).toFixed(1)}s`,
  );
  for (const r of results) {
    if (r.undocumented.length > 0) log(`[api-reference]   ${r.name}: ${r.undocumented.length} of ${r.exports} exports have no doc comment`);
    if (r.warnings.length > 0) log(`[api-reference]   ${r.name}: ${r.warnings.length} TypeDoc warnings`);
    if (r.unlinked.length > 0) log(`[api-reference]   ${r.name}: ${r.unlinked.length} comment links to an anchor the page lacks, left as text`);
  }
  log(`[api-reference] the list: ${relative(root, reportFile)}`);
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
