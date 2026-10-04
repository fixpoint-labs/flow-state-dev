/**
 * Tells a page build that is older than its source from one that isn't.
 *
 * A Vite build of a checked-in app is a snapshot. Whatever serves it later
 * (Shift Manager's start script, `fsdev dev` serving the DevTool) has no way to
 * know the source moved on since, so a rename in the source leaves the served
 * page reading keys the server no longer publishes, and the page reports that
 * as a data problem.
 *
 * `recordBuildInputs()` is a Vite plugin that writes `build-inputs.json` into
 * the build: every source file in this repository the bundle was made from,
 * outside `node_modules`, with a hash of its contents. `staleBuildInputs()`
 * re-hashes those files and names the first one that changed or is gone. A
 * build with no record at all counts as stale, since nothing vouches for it.
 *
 * Hashes, not mtimes, so a checkout that rewrites files without changing them
 * doesn't count. Third-party dependencies are not recorded: a lockfile change
 * alone is not detected.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** The record's file name inside a build's output directory. */
export const BUILD_INPUTS_FILE = "build-inputs.json";

/** @param {string} file */
const hashOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * A Vite plugin that records the build's repository source files and their
 * hashes in `<outDir>/build-inputs.json`. Paths are relative to `repoRoot`, so
 * the record still holds when the build is copied elsewhere in the checkout.
 *
 * @param {{ repoRoot: string }} options
 */
export function recordBuildInputs({ repoRoot }) {
  /** @type {string} */
  let outDir;
  return {
    name: "record-build-inputs",
    apply: /** @type {const} */ ("build"),
    /** @param {{ root: string, build: { outDir: string } }} config */
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    /** @this {{ getModuleIds(): IterableIterator<string> }} */
    writeBundle() {
      /** @type {Record<string, string>} */
      const inputs = {};
      for (const id of this.getModuleIds()) {
        const file = id.split("?")[0];
        if (!isAbsolute(file) || file.includes(`${sep}node_modules${sep}`) || !existsSync(file)) continue;
        const path = relative(repoRoot, file);
        if (path.startsWith("..")) continue;
        inputs[path.split(sep).join("/")] = hashOf(file);
      }
      writeFileSync(join(outDir, BUILD_INPUTS_FILE), `${JSON.stringify({ inputs }, null, 2)}\n`);
    },
  };
}

/**
 * Why the build in `buildDir` is older than its source, or `undefined` when
 * every file it was built from is unchanged.
 *
 * @param {string} buildDir
 * @param {string} repoRoot
 * @returns {string | undefined}
 */
export function staleBuildInputs(buildDir, repoRoot) {
  const record = join(buildDir, BUILD_INPUTS_FILE);
  if (!existsSync(record)) return `it has no ${BUILD_INPUTS_FILE}, so nothing says which source it was built from`;
  /** @type {{ inputs: Record<string, string> }} */
  const { inputs } = JSON.parse(readFileSync(record, "utf8"));
  for (const [path, hash] of Object.entries(inputs)) {
    const file = join(repoRoot, path);
    if (!existsSync(file)) return `${path} is gone since it was built`;
    if (hashOf(file) !== hash) return `${path} changed since it was built`;
  }
  return undefined;
}
