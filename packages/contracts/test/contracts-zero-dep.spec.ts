/**
 * Guard: `@flow-state-dev/contracts` is and stays dependency-free.
 *
 * This is the authoritative, machine-checked statement of the contracts
 * invariant the topology exists to enforce — a zero-dependency shared layer
 * the browser, the authoring ecosystem, and external packages can value-import
 * without dragging in the heavy authoring runtime (zod, picomatch, liquidjs,
 * gray-matter, cron-parser). Two assertions back it:
 *
 *   1. `package.json` declares no `dependencies` (and no `peerDependencies`).
 *   2. No file under `src/` imports/exports from a non-relative specifier —
 *      i.e. nothing reaches a workspace package or an external module.
 *
 * If either regresses, this test fails loudly in CI instead of the heavy deps
 * silently re-entering the browser bundle.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const srcDir = path.join(pkgRoot, "src");

/** Recursively collect every `.ts`/`.tsx` file under a directory. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Matches `import ... from "X"`, `export ... from "X"`, and bare `import "X"`.
const importPattern = /(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

describe("@flow-state-dev/contracts zero-dependency invariant", () => {
  it("declares no runtime or peer dependencies", () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it("imports nothing outside its own relative module graph", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        if (specifier === undefined) continue;
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        if (!isRelative) {
          offenders.push(`${path.relative(pkgRoot, file)}: "${specifier}"`);
        }
      }
    }
    expect(offenders, `non-relative imports leak into contracts:\n${offenders.join("\n")}`).toEqual([]);
  });
});
