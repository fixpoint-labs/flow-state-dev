/**
 * Imports an `fsdev.config.*` module and returns its namespace. The one place
 * that decides HOW a config file is loaded; {@link loadFsdevConfig} in
 * `load-config.ts` decides WHICH file and validates what it exports.
 *
 * A `.ts`/`.mts` config is tried with a native `import()` first, then loaded
 * through jiti when Node can't load it: extensionless relative imports
 * (`./src/flows/chat/flow`), `tsconfig` path aliases (`@/flows/chat/flow`), a
 * Node without type stripping, or TypeScript that stripping can't erase. The native attempt comes first so that, whatever loader
 * hosts the CLI (plain Node, tsx, vitest), the framework packages the config
 * imports keep their module identity with the ones the CLI itself imports. jiti
 * also imports ESM packages under `node_modules` natively, so a published CLI
 * keeps that identity on the jiti path too.
 *
 * A `.js`/`.mjs` config is always a plain native `import()`.
 *
 * Leaf module (only `node:` and `jiti` imports) so plain Node can load it
 * directly; the loader test runs it that way.
 */
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

/**
 * Node error codes from a native `import()` of a TypeScript config that mean
 * "Node can't load this file", not "this file failed". For the config's static
 * imports they are raised while the module graph loads, before any of its code
 * runs, so the jiti retry doesn't evaluate the config twice.
 */
const NATIVE_TS_LOAD_FAILURES = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
  "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
]);

/** Monotonic suffix making each native import URL unique even within the same ms. */
let loadCounter = 0;

/**
 * Import the config module at `absPath` and return its namespace. Every call
 * evaluates the file afresh (cache-busted native URL, jiti with no module
 * cache), so repeated loads in one process get an undisposed `FlowState`.
 * Throws whatever the final attempt threw.
 */
export async function importConfigModule(absPath: string): Promise<{ default?: unknown }> {
  const url = `${pathToFileURL(absPath).href}?t=${Date.now()}-${loadCounter++}`;
  if (!/\.m?ts$/.test(absPath)) {
    return (await import(url)) as { default?: unknown };
  }
  try {
    return (await import(url)) as { default?: unknown };
  } catch (err) {
    if (!NATIVE_TS_LOAD_FAILURES.has((err as { code?: string }).code ?? "")) throw err;
  }
  // `tsconfigPaths` resolves the app's `compilerOptions.paths` aliases (`@/...`),
  // found by walking up from the config file.
  const jiti = createJiti(absPath, { moduleCache: false, interopDefault: false, tsconfigPaths: true });
  return (await jiti.import(absPath)) as { default?: unknown };
}
