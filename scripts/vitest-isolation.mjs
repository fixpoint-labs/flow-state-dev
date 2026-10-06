/**
 * Run a package's tests on a shared module cache, except the files that cannot.
 *
 * Vitest's default `isolate: true` re-imports every test file's module graph in
 * a fresh context. For a package whose tests each pull in the engine and core
 * source, that import is most of the run: in `@flow-state-dev/engine` it was
 * ~207s of worker time against ~71s of tests. `isolate: false` lets the files a
 * worker runs share the modules it already loaded.
 *
 * Sharing breaks two kinds of file, and this splits them out to run isolated
 * (each on a fresh module cache):
 *
 * - A file that calls `vi.mock` / `vi.doMock`. A mock is installed when its
 *   module is first imported, so it cannot take effect once an earlier file on
 *   the same worker has loaded the real module. Found by reading the source, so
 *   a new mocking file is isolated without anyone listing it.
 * - A file that depends on module state another file changes first (a
 *   warn-once flag, a module-level registry). These cannot be found by reading,
 *   so the package lists them in `alsoIsolate`.
 *
 * A file in neither group that fails only under the full run, and passes on its
 * own, is the second kind: add it to `alsoIsolate`.
 */
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDefaults } from "vitest/config";

const MOCKS_A_MODULE = /\bvi\s*\.\s*(?:mock|doMock)\s*\(/;

/**
 * @typedef {object} IsolationOptions
 * @property {string[]} [include] The package's `test.include`, when it sets one.
 * @property {string[]} [alsoIsolate] Files that leak or read module state across files.
 */

/**
 * The test files under `root` that must run isolated: those that mock a module,
 * and `alsoIsolate`. Paths are relative to `root`, as Vitest's `include` takes
 * them.
 *
 * @param {string} root The package directory (the Vitest root).
 * @param {IsolationOptions} [options]
 * @returns {string[]}
 */
export function isolatedTestFiles(root, { include = configDefaults.include, alsoIsolate = [] } = {}) {
  const files = globSync(include, { cwd: root, exclude: configDefaults.exclude });
  const mocking = files.filter((file) => MOCKS_A_MODULE.test(readFileSync(join(root, file), "utf8")));
  return [...new Set([...mocking, ...alsoIsolate])].sort();
}

/**
 * The `test` options that run a package this way: spread into its `test` config.
 *
 * The pool reads `isolate` from the root config only, so the root turns it off
 * and the workers are reused. Each project's own `isolate` decides whether a
 * worker resets its module cache before each file: `shared` does not, and
 * `isolated` does, which is what lets a file's `vi.mock` take effect.
 *
 * @param {string} root The package directory (the Vitest root).
 * @param {IsolationOptions} [options]
 */
export function sharedModuleCache(root, options = {}) {
  const isolated = isolatedTestFiles(root, options);
  return {
    isolate: false,
    projects: [
      { extends: true, test: { name: "shared", exclude: [...configDefaults.exclude, ...isolated] } },
      ...(isolated.length === 0 ? [] : [{ extends: true, test: { name: "isolated", include: isolated, isolate: true } }]),
    ],
  };
}
