/**
 * Resolve `fsdev dev --app <package|dir>` to the directory of built pages it
 * names.
 *
 * A directory (a path that exists, or one written as a path) must hold an
 * `index.html`. Anything else is a package name, resolved from the working
 * directory the way the app's own project resolves it, whose `getAssetPath()`
 * returns that directory: the same contract `@flow-state-dev/devtool` exports.
 */
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "./resolve-block";
import { EXIT_CONFIG_ERROR } from "./exit-codes";

/**
 * The absolute directory of built pages `app` names. Relative paths and package
 * names resolve from `cwd`.
 *
 * @throws CliError (exit 3) when the directory or package is missing, the
 *   package has no `getAssetPath()` or it throws, or the directory holds no
 *   `index.html`.
 */
export async function resolveAppPages(app: string, cwd: string): Promise<string> {
  const asPath = resolve(cwd, app);
  const looksLikePath = app.startsWith(".") || isAbsolute(app);
  if (looksLikePath || existsSync(asPath)) {
    if (!existsSync(asPath) || !statSync(asPath).isDirectory()) {
      throw new CliError(`--app: no directory at ${asPath}.`, EXIT_CONFIG_ERROR);
    }
    return requireIndex(asPath, `--app ${app}`);
  }
  return requireIndex(await packageAssetPath(app, cwd), `--app ${app} (getAssetPath())`);
}

/** Import `name` as installed under `cwd` and call its `getAssetPath()`. */
async function packageAssetPath(name: string, cwd: string): Promise<string> {
  let entry: string;
  try {
    entry = createRequire(join(cwd, "package.json")).resolve(name);
  } catch (err) {
    throw new CliError(
      `--app: "${name}" is neither a directory nor a package installed from ${cwd}: ` +
        `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
  let mod: { getAssetPath?: unknown };
  try {
    mod = (await import(pathToFileURL(entry).href)) as { getAssetPath?: unknown };
  } catch (err) {
    throw new CliError(
      `--app: package "${name}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
  if (typeof mod.getAssetPath !== "function") {
    throw new CliError(
      `--app: package "${name}" doesn't export getAssetPath(), the function returning its built pages' directory.`,
      EXIT_CONFIG_ERROR,
    );
  }
  let dir: unknown;
  try {
    dir = (mod.getAssetPath as () => unknown)();
  } catch (err) {
    throw new CliError(
      `--app: getAssetPath() of "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
  if (typeof dir !== "string") {
    throw new CliError(`--app: getAssetPath() of "${name}" returned no directory path.`, EXIT_CONFIG_ERROR);
  }
  return dir;
}

/** `dir`, once it holds an `index.html`. */
function requireIndex(dir: string, label: string): string {
  if (!existsSync(join(dir, "index.html"))) {
    throw new CliError(`${label}: no index.html in ${dir}.`, EXIT_CONFIG_ERROR);
  }
  return dir;
}
