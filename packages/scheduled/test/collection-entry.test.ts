/**
 * `@flow-state-dev/scheduled` loads no engine, from any entry: Workforce
 * defines its schedules from it and must not load the engine (its package
 * rules deny it), and the engine's own scheduled endpoint is what a schedule
 * fires through, so the engine never imports this package and this package
 * never imports the engine. Walks each entry's relative imports and reads
 * every package each file imports.
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

describe("the package's entries", () => {
  it.each(["index.ts", "collection.ts", "testing.ts"])("%s loads no engine, at any depth", (entry) => {
    const loaded = graph(entry);
    const engine = [...loaded].filter(([, packages]) => packages.some((p) => p.startsWith("@flow-state-dev/engine")));
    expect(engine.map(([file]) => file)).toEqual([]);
  });

  it("would see a package an entry loads", () => {
    // The walk is able to fail: it reaches past the entry file and reads the
    // packages the files it reaches import.
    const loaded = graph("index.ts");
    expect(loaded.size).toBeGreaterThan(1);
    expect([...loaded.values()].flat()).toContain("@flow-state-dev/core");
  });
});
