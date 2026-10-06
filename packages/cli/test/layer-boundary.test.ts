/**
 * The layer line for serving an app beside a Lab: fsdev's app hook and
 * `@flow-state-dev/node`'s page options are generic. An app that sits beside
 * them (Shift Manager is one) plugs its policy in as page meta; neither module
 * imports Workforce or that app, or names its concepts.
 *
 * Reads the hook's source files. The second case plants a violation in a copy
 * to prove the scan can fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packages = resolve(import.meta.dirname, "..", "..");

/** The modules that make up the hook. */
const HOOK_MODULES = [
  "cli/src/commands/dev.ts",
  "cli/src/dev-app.ts",
  "cli/src/dev-vite.ts",
  "cli/src/dev-watch.ts",
  "cli/src/dev-watch-preload.ts",
  "node/src/serve.ts",
  "node/src/page-html.ts",
  "node/src/devtool-config-injection.ts",
];

const FORBIDDEN_IMPORT = /from\s+["']@flow-state-dev\/(workforce|shift-manager)(\/[^"']*)?["']|import\(\s*["']@flow-state-dev\/(workforce|shift-manager)/;
const FORBIDDEN_WORD = /\b(teams?|workers?|rosters?|shifts?|seats?|workforce|shift[- ]manager)\b/i;

/** Each line of `source` that imports Workforce or Shift Manager, or names their concepts. */
function layerViolations(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => FORBIDDEN_IMPORT.test(line) || FORBIDDEN_WORD.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

describe("app hook layer line", () => {
  it.each(HOOK_MODULES)("%s imports no Workforce or Shift Manager module and names none of their concepts", (file) => {
    const source = readFileSync(resolve(packages, file), "utf8");
    expect(layerViolations(source)).toEqual([]);
  });

  it("flags a planted import and a planted word", () => {
    const source = readFileSync(resolve(packages, "cli/src/commands/dev.ts"), "utf8");
    expect(layerViolations(`${source}\nimport { hireWorkforce } from "@flow-state-dev/workforce";\n`)).toHaveLength(1);
    expect(layerViolations(`${source}\nconst x = await import("@flow-state-dev/shift-manager");\n`)).toHaveLength(1);
    expect(layerViolations(`${source}\n// pick the team's roster\n`)).toHaveLength(1);
  });
});
