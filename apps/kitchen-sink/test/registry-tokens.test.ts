/**
 * This app's stylesheet carries the registry's token defaults.
 *
 * Kitchen-sink keeps its tokens in Tailwind's `@theme` form rather than
 * installing the registry's `tokens` item, so its copies of the registry
 * components render the colours any app installing them would see only while
 * this stylesheet holds the same values. The companion to the drift check:
 * that one holds the components to the registry, this one their colours.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registryTokenDefaults, stylesheetColours } from "../../../packages/ui/scripts/token-defaults";

const globalsCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"), "utf8");

describe("kitchen-sink token defaults", () => {
  const { light, dark } = registryTokenDefaults();

  it("defines every registry token with its light default", () => {
    expect(Object.keys(light)).toContain("attention");
    expect(stylesheetColours(globalsCss, "@theme {")).toEqual(light);
  });

  it("defines every registry token with its dark default", () => {
    expect(stylesheetColours(globalsCss, ".dark {")).toEqual(dark);
  });
});
