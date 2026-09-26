/**
 * Static import-graph walk for browser-safe entry points.
 *
 * A package that publishes an entry as safe to bundle for a browser needs a
 * test that fails when a module reachable from that entry imports a Node
 * built-in. A bundler can't resolve `node:async_hooks`, so the break shows up
 * in the consumer's build, usually several modules away from the entry. This
 * walks the source graph from the entry and reports each built-in it reaches,
 * with the chain of modules that reached it.
 *
 * {@link findImportsFromEntry} is the same walk with the predicate supplied by
 * the caller, for a boundary drawn around something other than built-ins (an
 * app's client components must not value-import a server-only package root).
 *
 * The walk reads source text; it does not run a resolver. It follows relative
 * specifiers (and any configured path aliases) to `.ts`/`.tsx` files and skips
 * `import type` / `export type`, which are erased before a bundler sees them.
 * Other bare specifiers (`zod`) are never followed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

/** Options for {@link findNodeBuiltinsFromEntry} and {@link findImportsFromEntry}. */
export interface FindNodeBuiltinsOptions {
  /**
   * Also follow bare specifiers that name a sibling workspace package
   * (`@flow-state-dev/core/items`) into its source, through that package's
   * `exports`. Siblings are the directories next to the entry's package
   * (`packages/*`). Default `false`: only the entry package's own relative
   * graph is walked.
   */
  followWorkspacePackages?: boolean;
  /**
   * Path aliases to follow like relative specifiers, as prefix → absolute
   * directory: `{ "@/": appDir }` resolves `@/lib/x` to `<appDir>/lib/x.ts`.
   * Mirrors a tsconfig `paths` entry such as `"@/*": ["./*"]`.
   */
  aliases?: Record<string, string>;
}

const NODE_BUILTINS = new Set(builtinModules);

// `import ... from "X"`, `export ... from "X"`, and bare `import "X"`.
const IMPORT_PATTERN =
  /(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  // `fs`, `path`, … and their subpaths (`fs/promises`).
  return NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(specifier.split("/")[0]);
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && /\.tsx?$/.test(c));
}

/** The nearest directory at or above `file` that holds a `package.json`. */
function packageRootOf(file: string): string {
  let dir = path.dirname(file);
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${file} is not inside a package`);
    dir = parent;
  }
  return dir;
}

type ExportsMap = Record<string, string | { default?: string }>;

/** Workspace package name → its directory, for every package in `packagesDir`. */
function readWorkspacePackages(packagesDir: string): Map<string, string> {
  const packages = new Map<string, string>();
  for (const dir of readdirSync(packagesDir)) {
    const manifest = path.join(packagesDir, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
    if (name !== undefined) packages.set(name, path.join(packagesDir, dir));
  }
  return packages;
}

/**
 * Resolve `@scope/pkg[/sub]` to the source file its `exports` names, or
 * `undefined` when it is not a workspace package. Throws when it is one but
 * the subpath is not exported, since the walk would otherwise go silently
 * blind past it.
 */
function resolveWorkspace(
  specifier: string,
  packages: Map<string, string>
): string | undefined {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/");
  const dir = packages.get(name);
  if (dir === undefined) return undefined;
  const subpath = parts.length > nameLength ? `./${parts.slice(nameLength).join("/")}` : ".";
  const { exports } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    exports?: ExportsMap;
  };
  let entry = exports?.[subpath];
  let star: string | undefined;
  if (entry === undefined) {
    // A pattern export: `"./items/*": "./src/items/*.ts"`.
    for (const [key, value] of Object.entries(exports ?? {})) {
      const [head, tail] = key.split("*");
      if (tail === undefined || !subpath.startsWith(head) || !subpath.endsWith(tail)) continue;
      entry = value;
      star = subpath.slice(head.length, subpath.length - tail.length);
      break;
    }
  }
  const pattern = typeof entry === "string" ? entry : entry?.default;
  const target = star === undefined ? pattern : pattern?.replace("*", star);
  if (target === undefined) {
    throw new Error(`${specifier} is not an export of ${name}; the walk cannot follow it`);
  }
  return path.join(dir, target);
}

/**
 * Walk the import graph from `entry` (an absolute path to a source file) and
 * return one line per value import whose specifier `isOffending` accepts, each
 * naming the specifier and the module chain that reached it, with paths
 * relative to the directory that holds the entry's package
 * (`orchestration/src/tasks/index.ts -> …`). An offending import is reported,
 * not followed. An empty array means the entry is clean.
 *
 * @example
 * ```ts
 * const offenders = findImportsFromEntry(
 *   path.join(appDir, "components/panel.tsx"),
 *   (specifier) => specifier === "@flow-state-dev/workforce",
 *   { aliases: { "@/": appDir } }
 * );
 * expect(offenders).toEqual([]);
 * ```
 */
export function findImportsFromEntry(
  entry: string,
  isOffending: (specifier: string) => boolean,
  options: FindNodeBuiltinsOptions = {}
): string[] {
  const packagesDir = path.dirname(packageRootOf(entry));
  const packages = options.followWorkspacePackages
    ? readWorkspacePackages(packagesDir)
    : undefined;
  const aliases = Object.entries(options.aliases ?? {});
  const offenders: string[] = [];
  const seen = new Set<string>();

  const resolve = (file: string, specifier: string): string | undefined => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return resolveRelative(file, specifier);
    }
    const alias = aliases.find(([prefix]) => specifier.startsWith(prefix));
    if (alias !== undefined) {
      const [prefix, dir] = alias;
      return resolveRelative(path.join(dir, "_"), `./${specifier.slice(prefix.length)}`);
    }
    return packages !== undefined ? resolveWorkspace(specifier, packages) : undefined;
  };

  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);

    const content = readFileSync(file, "utf8");
    const nextChain = [...chain, path.relative(packagesDir, file)];

    for (const match of content.matchAll(IMPORT_PATTERN)) {
      // `import type` / `export type` is erased before it reaches a bundler.
      if (/^(?:import|export)\s+type\b/.test(match[0])) continue;

      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;

      if (isOffending(specifier)) {
        offenders.push(`  "${specifier}" via ${nextChain.join(" -> ")}`);
        continue;
      }
      const resolved = resolve(file, specifier);
      if (resolved !== undefined) walk(resolved, nextChain);
    }
  };

  walk(entry, []);
  return offenders;
}

/**
 * Walk the import graph from `entry` (an absolute path to a source file) and
 * return one line per Node built-in reached (`node:fs`, `path`,
 * `fs/promises`), each with the module chain that reached it. An empty array
 * means the entry is clean.
 *
 * @example
 * ```ts
 * const offenders = findNodeBuiltinsFromEntry(path.join(pkgRoot, "src/browser.ts"), {
 *   followWorkspacePackages: true,
 * });
 * expect(offenders).toEqual([]);
 * ```
 */
export function findNodeBuiltinsFromEntry(
  entry: string,
  options: FindNodeBuiltinsOptions = {}
): string[] {
  return findImportsFromEntry(entry, isNodeBuiltin, options);
}
