/**
 * Resolve a package's export the way Node's ESM loader would for an
 * `import`, from a given folder: the installed package found in the
 * `node_modules` folders from there up, and the target read from its own
 * `exports` under the `import` condition, else `default`.
 *
 * For the commands that load a package the app installed (its Vite, a
 * generator) rather than one fsdev depends on. `createRequire().resolve()`
 * would apply `require` conditions instead, missing an `import`-only export
 * and picking a different file where the two differ.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** An `exports` target: a path, or conditions that may nest further. */
type Target = string | { import?: Target; default?: Target } | null | undefined;

/** The path a target names under `import`, else `default`. */
function pick(target: Target): string | undefined {
  if (typeof target === "string") return target;
  if (target === null || target === undefined) return undefined;
  return pick(target.import ?? target.default);
}

/**
 * The file `import("<name>/<subpath>")` loads from `from`, or `undefined` when
 * the package is not installed there or does not export that subpath.
 *
 * @param from The folder resolution starts in.
 * @param name The package name.
 * @param subpath The export key: `"."` or `"./x"`.
 */
export function resolvePackageExport(from: string, name: string, subpath: string): string | undefined {
  let manifest: string | undefined;
  for (let dir = resolve(from); manifest === undefined; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) manifest = candidate;
    else if (dirname(dir) === dir) return undefined;
  }
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
    exports?: string | Record<string, Target>;
  };
  // A bare string or a conditions object stands for `"."` alone.
  const exports = pkg.exports;
  const map =
    typeof exports === "string" || (exports !== undefined && !Object.keys(exports).some((k) => k.startsWith(".")))
      ? { ".": exports as Target }
      : (exports ?? {});
  const relative = pick(map[subpath]);
  return relative === undefined ? undefined : join(dirname(manifest), relative);
}
