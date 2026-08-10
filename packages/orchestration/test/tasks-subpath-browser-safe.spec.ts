/**
 * Guard: `@flow-state-dev/orchestration/tasks` stays browser-safe.
 *
 * `docs/architecture/items.md` publishes that subpath as browser-safe, so a UI
 * can value-import `extractTaskItems` and attribute items with the same
 * algorithm the substrate uses. A browser bundler cannot resolve a Node
 * built-in, so one module joining this entry with a `node:` import breaks every
 * consumer of that promise — at bundle time, in their build, not ours.
 *
 * That is exactly how it broke: `lease-renewal.ts` needs `node:async_hooks`,
 * was re-exported from this entry, and nothing noticed for six rounds of
 * review. The package as a whole is Node-only and allowed to be — the task
 * board uses `AsyncLocalStorage` too, and the main entry reaches `node:fs`
 * through skills. The constraint belongs to **this entry point**, not to the
 * package, which is why the check has to walk the reachable graph from the
 * entry rather than scan `src/` the way the contracts guard does.
 *
 * Scope: our own relative module graph. A bare specifier (`zod`,
 * `@flow-state-dev/core`) is not followed — those carry their own guarantees,
 * and `contracts-zero-dep.spec.ts` is the precedent for pinning them at their
 * own boundary.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

/** Entry points this package publishes as safe to bundle for a browser. */
const BROWSER_SAFE_ENTRIES = ["src/tasks/index.ts"];

const NODE_BUILTINS = new Set(builtinModules);

// `import ... from "X"`, `export ... from "X"`, and bare `import "X"`.
const importPattern =
  /(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  // `fs`, `path`, … and their subpaths (`fs/promises`).
  return NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(specifier.split("/")[0]);
}

/** Resolve a relative specifier to a concrete source file, or `undefined`. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && c.endsWith(".ts"));
}

/**
 * Walk the relative import graph from `entry`, returning one
 * `file -> node:builtin` line per violation, each with the chain that reached
 * it — the chain is the point, since the offending import is usually several
 * modules away from the entry that has to stay clean.
 */
function findNodeBuiltins(entry: string): string[] {
  const offenders: string[] = [];
  const seen = new Set<string>();

  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);

    const content = readFileSync(file, "utf8");
    const rel = path.relative(pkgRoot, file);
    const nextChain = [...chain, rel];

    for (const match of content.matchAll(importPattern)) {
      const statement = match[0];
      // `import type` / `export type` is erased before it reaches a bundler.
      if (/^(?:import|export)\s+type\b/.test(statement)) continue;

      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;

      if (isNodeBuiltin(specifier)) {
        offenders.push(`  "${specifier}" via ${nextChain.join(" -> ")}`);
        continue;
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;

      const resolved = resolveRelative(file, specifier);
      if (resolved !== undefined) walk(resolved, nextChain);
    }
  };

  walk(path.join(pkgRoot, entry), []);
  return offenders;
}

describe("browser-safe subpath exports", () => {
  for (const entry of BROWSER_SAFE_ENTRIES) {
    it(`${entry} reaches no Node built-in`, () => {
      const offenders = findNodeBuiltins(entry);
      expect(
        offenders,
        `${entry} is published as browser-safe but reaches Node built-ins:\n${offenders.join(
          "\n"
        )}\n\nEither keep the new module off this entry (export it from the ` +
          `package's main entry, which is Node-only), or drop the built-in.`
      ).toEqual([]);
    });
  }

  it("the entry still exports the utility the docs promise", () => {
    // Guards the other direction: "fix" the check by emptying the entry and
    // this fails. `extractTaskItems` is the export `docs/architecture/items.md`
    // names as the reason this subpath is browser-safe at all.
    const entry = readFileSync(path.join(pkgRoot, "src/tasks/index.ts"), "utf8");
    expect(entry).toMatch(/extractTaskItems/);
  });
});
