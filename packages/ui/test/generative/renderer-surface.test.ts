/**
 * Guard: the generative-UI **renderer surface** never value-imports the heavy
 * authoring runtime. This is the machine-checkable statement of the topology's
 * central boundary — "no browser-bundled package value-imports
 * `@flow-state-dev/core`."
 *
 * Starting from `src/generative/renderers.ts`, we walk the *runtime* module
 * graph: we follow only **value** imports along relative paths (type-only
 * imports are erased, so they don't pull a module into the bundle) and fail if
 * any reachable file value-imports `@flow-state-dev/core` (or a `core/*`
 * subpath) or `zod`. A renderer may `import type` its `*Data` shape from a
 * zod-valued `schema.ts` — that's allowed; a *value* import of the schema (or
 * of `handler`) into the renderer graph is a violation.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const generativeDir = path.resolve(here, "../../src/generative");
const entry = path.join(generativeDir, "renderers.ts");

/** Resolve a relative import specifier to a concrete source file, or undefined. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

type ParsedImport = { specifier: string; typeOnly: boolean };

/**
 * Parse a file's import/export-from statements. A statement counts as a runtime
 * (value) edge unless it is `import type` / `export type`, or every named
 * binding is inline-`type`-qualified.
 */
function parseImports(content: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const re =
    /(import|export)\s+(type\s+)?([^"';]*?)\s*(?:from\s*)?["']([^"']+)["']/g;
  for (const m of content.matchAll(re)) {
    const isTypeKeyword = m[2] !== undefined;
    const clause = m[3] ?? "";
    const specifier = m[4]!;
    // A braced clause whose every named binding is `type X` is fully erased.
    const named = clause.match(/\{([^}]*)\}/);
    const allInlineType =
      named !== null &&
      named[1]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .every((s) => s.startsWith("type "));
    out.push({ specifier, typeOnly: isTypeKeyword || allInlineType });
  }
  return out;
}

function isForbidden(specifier: string): boolean {
  return (
    specifier === "@flow-state-dev/core" ||
    specifier.startsWith("@flow-state-dev/core/") ||
    specifier === "zod" ||
    specifier.startsWith("zod/")
  );
}

describe("generative renderer surface", () => {
  it("never value-imports @flow-state-dev/core or zod", () => {
    const visited = new Set<string>();
    const violations: string[] = [];

    function walk(file: string): void {
      if (visited.has(file)) return;
      visited.add(file);
      const content = readFileSync(file, "utf8");
      for (const imp of parseImports(content)) {
        if (imp.typeOnly) continue; // erased — not in the runtime graph
        if (isForbidden(imp.specifier)) {
          violations.push(`${path.relative(generativeDir, file)} → "${imp.specifier}"`);
          continue;
        }
        if (imp.specifier.startsWith(".")) {
          const resolved = resolveRelative(file, imp.specifier);
          if (resolved !== undefined) walk(resolved);
        }
      }
    }

    walk(entry);

    expect(
      violations,
      `renderer surface value-imports the heavy authoring runtime:\n${violations.join("\n")}`,
    ).toEqual([]);
    // Sanity: the walk actually traversed the renderer modules.
    expect(visited.size).toBeGreaterThan(1);
  });
});
