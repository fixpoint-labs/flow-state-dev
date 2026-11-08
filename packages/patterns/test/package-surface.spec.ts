/**
 * Guard: what `@flow-state-dev/patterns` publishes, read the way an adopter meets it.
 *
 * Two rules. Every subpath is kebab-case, so `./event-actors` sits beside `./round-robin`
 * and nobody guesses the casing of an import. And the root carries only names an adopter
 * uses: each root name is imported by an app, example, lab or docs page, named by the
 * README, or reached through the signature of one that is. A name with no such reader
 * keeps its home on its pattern's subpath, or isn't exported at all.
 *
 * The root rule is read by the repo's export check (`scripts/check-root-exports.mjs`),
 * the same census CI runs, not by a second walker here. The benchmark adapters are the one
 * exception: they leave the root with their own entry, so a failing name declared under
 * `src/benchmark/` is not this guard's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fsReader, packageEntryExports, type Reader } from "../../../scripts/mechanism-exports.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const PKG = "@flow-state-dev/patterns";
const ROOT_ENTRY = "packages/patterns/src/index.ts";
const BENCHMARK_DIR = "packages/patterns/src/benchmark/";
/** The export check reads every published root and the whole import census: seconds, not ms. */
const CENSUS_TIMEOUT_MS = 120_000;

interface RootReport {
  roots: Map<string, Map<string, { file: string; why: string }>>;
}
// Untyped script; the specifier is computed so the import is not resolved at typecheck.
const checkScript = pathToFileURL(path.join(repoRoot, "scripts/check-root-exports.mjs")).href;
const { rootReport } = (await import(checkScript)) as { rootReport: (read: Reader) => RootReport };
const censusScript = pathToFileURL(path.join(repoRoot, "scripts/import-census.mjs")).href;
const { importCensus } = (await import(censusScript)) as {
  importCensus: (read: Reader) => { uses: Map<string, Map<string, Set<string>>> };
};

/** Root names the export check fails, outside the benchmark entry, reading through `read`. */
function failingRootNames(read: Reader): string[] {
  const root = rootReport(read).roots.get(PKG);
  if (!root) throw new Error(`${PKG} not found in the export check's report`);
  return [...root]
    .filter(([, { file, why }]) => why === "failing" && !file.startsWith(BENCHMARK_DIR))
    .map(([name]) => name)
    .sort();
}

/** The working tree, with `extra` appended to the root entry's source. */
function readerWithRootLine(extra: string): Reader {
  const base = fsReader(repoRoot);
  const read = ((p: string) => {
    const text = base(p);
    return p === ROOT_ENTRY && text != null ? `${text}\n${extra}\n` : text;
  }) as Reader;
  return Object.assign(read, { packageDirs: base.packageDirs, list: base.list, tracked: base.tracked, grep: base.grep });
}

describe("patterns package surface", () => {
  it("every subpath is kebab-case, in exports and publishConfig.exports", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "packages/patterns/package.json"), "utf8"));
    const keys = [...Object.keys(pkg.exports), ...Object.keys(pkg.publishConfig.exports)];
    const notKebab = keys.filter((k) => !/^\.(\/[a-z0-9]+(-[a-z0-9]+)*)?$/.test(k));
    expect(notKebab, `These subpaths are not kebab-case: ${notKebab.join(", ")}`).toEqual([]);
  });

  it("the root carries no name without an adopter reader", () => {
    const failing = failingRootNames(fsReader(repoRoot));
    expect(
      failing,
      `These root names have no app, example, lab or docs importer, no README mention, and no ` +
        `used signature reaching them:\n${failing.join("\n")}\n\n` +
        `Export the name from its pattern's subpath only (drop it from src/index.ts), or stop ` +
        `exporting it if nothing reads it.`
    ).toEqual([]);
  }, CENSUS_TIMEOUT_MS);

  it("the root keeps every name an app or docs page imports from it", () => {
    // The other half of the rule: a name leaves the root only when nothing outside our
    // packages imports it there. Reads the same census the export check reads.
    const read = fsReader(repoRoot);
    const root = packageEntryExports(read).get(PKG)?.get(".");
    if (!root) throw new Error(`${PKG} lost its "." entry`);
    // A benchmark name moved to `./benchmark` with its own entry; the docs pages
    // that import it from the root are rewritten at release from the changeset.
    const benchmark = packageEntryExports(read).get(PKG)?.get("./benchmark") ?? new Map();
    const imported = importCensus(read).uses.get(PKG) ?? new Map<string, Set<string>>();
    const missing = [...imported]
      .filter(([name]) => !root.has(name) && !benchmark.has(name))
      .map(([name, areas]) => `${name} (${[...areas].join(", ")})`)
      .sort();
    expect(
      missing,
      `These names are imported from the ${PKG} root by an app or docs page, but the root ` +
        `doesn't export them:\n${missing.join("\n")}`
    ).toEqual([]);
  }, CENSUS_TIMEOUT_MS);

  it("would see a root name nothing reads", () => {
    // Proves the check above can fail: a root export nothing reads, added in memory, must
    // show up as failing. A report that stopped reading the root would pass above for free.
    expect(failingRootNames(readerWithRootLine(`export const zzSurfacePlant = 1;`))).toContain("zzSurfacePlant");
  }, CENSUS_TIMEOUT_MS);
});
