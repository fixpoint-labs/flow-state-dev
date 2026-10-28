/**
 * `@flow-state-dev/scheduled/collection` loads no engine: Workforce defines its
 * schedules from it and must not load the engine (its package rules deny it).
 * Walks the entry's relative imports and reads every package each file imports.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g;

/** Every module the entry loads at run time, and the packages each one imports. */
function graph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const text = readFileSync(file, "utf8");
    const packages: string[] = [];
    seen.set(file, packages);
    for (const match of text.matchAll(IMPORT)) {
      // A type-only import loads nothing at run time.
      if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
      const specifier = match[1]!;
      if (specifier.startsWith(".")) visit(resolve(dirname(file), `${specifier.replace(/\.js$/, "")}.ts`));
      else packages.push(specifier);
    }
  };
  visit(resolve(SRC, entry));
  return seen;
}

describe("the collection entry", () => {
  it("loads no engine, at any depth", () => {
    const loaded = graph("collection.ts");
    expect(loaded.size).toBeGreaterThan(1);
    const engine = [...loaded].filter(([, packages]) => packages.some((p) => p.startsWith("@flow-state-dev/engine")));
    expect(engine.map(([file]) => file)).toEqual([]);
  });

  it("would see the engine the root entry loads", () => {
    // The walk is able to fail: the root entry mounts the endpoint, which does load it.
    const loaded = graph("index.ts");
    expect([...loaded.values()].flat()).toContain("@flow-state-dev/engine");
  });
});
