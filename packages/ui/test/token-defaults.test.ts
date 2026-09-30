/**
 * The one `@theme` copy of the registry's token defaults.
 *
 * Storybook and kitchen-sink import `registry/token-defaults.css` rather than
 * keeping their own. This holds that file to the `tokens` item, token by
 * token, light and dark, and holds the preview to importing it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registryTokenDefaults, stylesheetColours } from "../scripts/token-defaults";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_CSS = resolve(ROOT, "registry/token-defaults.css");
const PREVIEW_CSS = resolve(ROOT, ".storybook/preview.css");

describe("the @theme copy of the token defaults", () => {
  const css = readFileSync(TOKEN_CSS, "utf8");
  const preview = readFileSync(PREVIEW_CSS, "utf8");
  const { light, dark } = registryTokenDefaults();

  it("reads the item's defaults, including the four status tokens", () => {
    for (const name of ["success", "warning", "info", "attention"]) {
      expect(light[name], name).toBeTruthy();
      expect(light[`${name}-foreground`], name).toBeTruthy();
      expect(dark[name], name).toBeTruthy();
    }
  });

  it("defines every token with the item's light value", () => {
    expect(stylesheetColours(css, "@theme {")).toEqual(light);
  });

  it("defines every token with the item's dark value", () => {
    expect(stylesheetColours(css, ".dark {")).toEqual(dark);
  });

  it("fails on one value that differs", () => {
    const edited = css.replace(/--color-attention: [^;]+;/, "--color-attention: hsl(0 0% 50%);");
    expect(stylesheetColours(edited, "@theme {")).not.toEqual(light);
  });

  it("is what the preview imports, with no second copy of the colours", () => {
    expect(preview).toContain('@import "../registry/token-defaults.css"');
    expect(preview).not.toMatch(/--color-attention\s*:/);
  });
});
