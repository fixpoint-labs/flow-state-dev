/**
 * Storybook's preview stylesheet carries the registry's token defaults.
 *
 * The preview keeps its own `@theme` copy rather than installing the `tokens`
 * item, so a story renders the colours an app installing the registry would
 * see. This holds that copy to the item, token by token, light and dark.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registryTokenDefaults, stylesheetColours } from "../scripts/token-defaults";

const PREVIEW_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../.storybook/preview.css");

describe("Storybook's token defaults", () => {
  const css = readFileSync(PREVIEW_CSS, "utf8");
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
});
