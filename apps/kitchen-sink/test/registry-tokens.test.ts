/**
 * Kitchen-sink imports the registry's one `@theme` sheet.
 *
 * The colours live in `packages/ui/registry/token-defaults.css`, held to the
 * `tokens` item by that package's test. This only stops the app restating them.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const globalsPath = join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css");
const globals = readFileSync(globalsPath, "utf8");
const imported = globals.match(/@import "([^"]*token-defaults\.css)"/)?.[1];

describe("kitchen-sink token defaults", () => {
  it("imports the one @theme sheet and does not restate the colours", () => {
    expect(imported).toBe("../../../packages/ui/registry/token-defaults.css");
    expect(existsSync(join(dirname(globalsPath), imported!))).toBe(true);
    expect(globals).not.toMatch(/--color-attention\s*:/);
  });
});
