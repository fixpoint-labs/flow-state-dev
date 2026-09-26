/**
 * Guard: `@flow-state-dev/workforce/browser` stays browser-safe.
 *
 * A client component imports that subpath for the names a panel reads with —
 * the roster key, the channel post component, the transcript line type. A
 * browser bundler cannot resolve a Node built-in, so one module on that graph
 * importing `node:async_hooks` fails the whole page at compile time, in the
 * consumer's dev server rather than in our tests.
 *
 * That is how it broke: a kitchen-sink client component took
 * `CHANNEL_POST_COMPONENT` from the package root, the constant lived in
 * `channel-flow.ts`, and that module reaches the orchestration task board,
 * which imports `node:async_hooks`. The offending import sat in ANOTHER
 * package, so unlike `orchestration/test/tasks-subpath-browser-safe.spec.ts`
 * this walk follows `@flow-state-dev/*` specifiers into their source through
 * each package's `exports`. Other bare specifiers (`zod`) are not followed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const packagesDir = path.resolve(pkgRoot, "..");

const NODE_BUILTINS = new Set(builtinModules);

// `import ... from "X"`, `export ... from "X"`, and bare `import "X"`.
const importPattern =
  /(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
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

/** Workspace package name → its directory, read once. */
const workspacePackages = new Map<string, string>();
for (const dir of readdirSync(packagesDir)) {
  const manifest = path.join(packagesDir, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
  if (name !== undefined) workspacePackages.set(name, path.join(packagesDir, dir));
}

/** Resolve `@flow-state-dev/x[/sub]` to the source file its `exports` names. */
function resolveWorkspace(specifier: string): string | undefined {
  const parts = specifier.split("/");
  const name = parts.slice(0, 2).join("/");
  const dir = workspacePackages.get(name);
  if (dir === undefined) return undefined;
  const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  const { exports } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    exports?: Record<string, string | { default?: string }>;
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
 * Walk the import graph from `entry`, returning one line per Node built-in
 * reached, each with the chain that reached it.
 */
function findNodeBuiltins(entry: string): string[] {
  const offenders: string[] = [];
  const seen = new Set<string>();

  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);

    const content = readFileSync(file, "utf8");
    const nextChain = [...chain, path.relative(packagesDir, file)];

    for (const match of content.matchAll(importPattern)) {
      // `import type` / `export type` is erased before it reaches a bundler.
      if (/^(?:import|export)\s+type\b/.test(match[0])) continue;

      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;

      if (isNodeBuiltin(specifier)) {
        offenders.push(`  "${specifier}" via ${nextChain.join(" -> ")}`);
        continue;
      }
      const resolved =
        specifier.startsWith("./") || specifier.startsWith("../")
          ? resolveRelative(file, specifier)
          : specifier.startsWith("@flow-state-dev/")
            ? resolveWorkspace(specifier)
            : undefined;
      if (resolved !== undefined) walk(resolved, nextChain);
    }
  };

  walk(entry, []);
  return offenders;
}

const browserEntry = resolveWorkspace("@flow-state-dev/workforce/browser");

describe("@flow-state-dev/workforce/browser", () => {
  it("reaches no Node built-in, in this package or a workspace package it imports", () => {
    const offenders = findNodeBuiltins(browserEntry!);
    expect(
      offenders,
      `the browser entry reaches Node built-ins:\n${offenders.join("\n")}\n\n` +
        "Move the name a browser needs into a leaf module and export it from there."
    ).toEqual([]);
  });

  it("still exports the names the kitchen-sink panels import", async () => {
    // The other direction: emptying the entry would pass the walk above.
    const entry = await import("../src/browser");
    expect(entry.CHANNEL_POST_COMPONENT).toBe("channel-post");
    expect(entry.HIRED_ROSTER_RESOURCE).toBe("hiredRoster");
    expect(typeof entry.splitSeatAddress).toBe("function");
  });

  it("finds the Node built-in the package root reaches through the channel floor", () => {
    // Proves the walk crosses into workspace packages: the root is NOT
    // browser-safe, and the offender lives in orchestration, not here.
    const offenders = findNodeBuiltins(resolveWorkspace("@flow-state-dev/workforce")!);
    expect(offenders.join("\n")).toMatch(/"node:async_hooks" via .*orchestration\/src\//);
  });
});
