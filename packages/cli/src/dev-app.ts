/**
 * Resolve `fsdev dev --app <package|dir>` to what serves its pages: a
 * directory of built pages, or, under `--watch`, its source through Vite.
 *
 * A directory (a path that exists, or one written as a path) must hold an
 * `index.html`. Anything else is a package name, resolved from the working
 * directory the way the app's own project resolves it, whose `getAssetPath()`
 * returns that directory: the same contract `@flow-state-dev/devtool` exports.
 * The path of a package's module file is taken as that package, so a command
 * that wraps `fsdev dev` can name itself from any working directory.
 * Under `--watch`, a package that also exports `getSourceRoot()` is served from
 * that folder through the Vite its own install resolves; when it returns
 * nothing, or no Vite resolves there, the built pages are served.
 */
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "./resolve-block";
import { resolvePackageExport } from "./package-export";
import { EXIT_CONFIG_ERROR } from "./exit-codes";

/** How `--app`'s pages are served: its built pages, or its source through Vite. */
export type AppPages =
  | { readonly kind: "built"; readonly dir: string }
  | { readonly kind: "source"; readonly root: string; readonly viteEntry: string };

/**
 * What serves the pages `app` names, and a line to print when `--watch` falls
 * back from source to built pages. Without `watch`, always the built pages.
 *
 * @throws CliError (exit 3) as {@link resolveAppPages}; also when
 *   `getSourceRoot()` throws, returns a non-string, or names a folder with no
 *   `index.html`.
 */
export async function resolveApp(
  app: string,
  cwd: string,
  watch: boolean,
): Promise<{ pages: AppPages; note?: string }> {
  if (watch && !looksLikeDirectory(app, cwd)) {
    const mod = await importAppPackage(app, cwd);
    if (typeof mod.getSourceRoot === "function") {
      const root = callExport(app, "getSourceRoot", mod.getSourceRoot, true);
      if (root !== undefined) {
        requireIndex(root, `--app ${app} (getSourceRoot())`);
        const viteEntry = resolveViteEntry(root);
        if (viteEntry !== undefined) return { pages: { kind: "source", root, viteEntry } };
        return {
          pages: { kind: "built", dir: await resolveAppPages(app, cwd) },
          note: `--app ${app}: Vite doesn't resolve from ${root}, so its built pages are served.`,
        };
      }
    }
  }
  return { pages: { kind: "built", dir: await resolveAppPages(app, cwd) } };
}

/**
 * The file Node imports for `vite` as installed under `root`, or `undefined`
 * when none is. Found in the `node_modules` folders from `root` up, so it is
 * the app's Vite: never one on `NODE_PATH`, which a package manager's bin shim
 * may point at fsdev's neighbours.
 */
function resolveViteEntry(root: string): string | undefined {
  return resolvePackageExport(root, "vite", ".");
}

/** Whether `--app` names a directory rather than a package (or a package's module file). */
function looksLikeDirectory(app: string, cwd: string): boolean {
  return (app.startsWith(".") || isAbsolute(app) || existsSync(resolve(cwd, app))) && moduleFile(app, cwd) === undefined;
}

/** The absolute path `--app` names when it is an existing file: a package's module. */
function moduleFile(app: string, cwd: string): string | undefined {
  const path = resolve(cwd, app);
  return existsSync(path) && statSync(path).isFile() ? path : undefined;
}

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
  if (looksLikeDirectory(app, cwd)) {
    if (!existsSync(asPath) || !statSync(asPath).isDirectory()) {
      throw new CliError(`--app: no directory at ${asPath}.`, EXIT_CONFIG_ERROR);
    }
    return requireIndex(asPath, `--app ${app}`);
  }
  return requireIndex(await packageAssetPath(app, cwd), `--app ${app} (getAssetPath())`);
}

/** Import `name` as installed under `cwd` and call its `getAssetPath()`. */
async function packageAssetPath(name: string, cwd: string): Promise<string> {
  const mod = await importAppPackage(name, cwd);
  if (typeof mod.getAssetPath !== "function") {
    throw new CliError(
      `--app: package "${name}" doesn't export getAssetPath(), the function returning its built pages' directory.`,
      EXIT_CONFIG_ERROR,
    );
  }
  return callExport(name, "getAssetPath", mod.getAssetPath, false)!;
}

/** The app package's module, as installed under `cwd`. */
async function importAppPackage(
  name: string,
  cwd: string,
): Promise<{ getAssetPath?: unknown; getSourceRoot?: unknown }> {
  let entry: string;
  try {
    entry = moduleFile(name, cwd) ?? createRequire(join(cwd, "package.json")).resolve(name);
  } catch (err) {
    throw new CliError(
      `--app: "${name}" is neither a directory nor a package installed from ${cwd}: ` +
        `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
  try {
    return (await import(pathToFileURL(entry).href)) as { getAssetPath?: unknown; getSourceRoot?: unknown };
  } catch (err) {
    throw new CliError(
      `--app: package "${name}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
}

/** Call one of the app's directory exports; `undefined`/`null` is allowed only when `optional`. */
function callExport(name: string, fn: string, call: unknown, optional: boolean): string | undefined {
  let dir: unknown;
  try {
    dir = (call as () => unknown)();
  } catch (err) {
    throw new CliError(
      `--app: ${fn}() of "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  }
  if (optional && (dir === undefined || dir === null)) return undefined;
  if (typeof dir !== "string") {
    throw new CliError(`--app: ${fn}() of "${name}" returned no directory path.`, EXIT_CONFIG_ERROR);
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
