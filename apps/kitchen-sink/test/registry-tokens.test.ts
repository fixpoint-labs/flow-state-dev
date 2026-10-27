/**
 * Kitchen Sink's look: the registry's `tokens` item, skinned by the design
 * system's one import.
 *
 * `app/tokens.css` is the item as `fsdev ui add` installs it, unedited, so the
 * Tailwind names read the token variables the design system sets. The brand
 * values come only from `@flow-state-dev/design-system`: no copy of one lives
 * in the app's own source, which the same search the design system's fence
 * runs over `packages/` checks here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import registry from "../../../packages/ui/registry.json";
import { SHIFT_MANAGER_CSS, findThemeValues, themeValues } from "../../../labs/design-system/test/theme";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const globals = readFileSync(join(appRoot, "app/globals.css"), "utf8");
const tokensCss = readFileSync(join(appRoot, "app/tokens.css"), "utf8");

type TokensItem = { cssVars: { theme: Record<string, string> }; css: Record<string, Record<string, Record<string, string>>> };
const tokens = registry.items.find((item) => item.name === "tokens") as unknown as TokensItem;

describe("kitchen-sink tokens", () => {
  it("keeps the registry's tokens item, unedited, in the file components.json names", () => {
    const components = JSON.parse(readFileSync(join(appRoot, "components.json"), "utf8")) as { tailwind: { css: string } };
    expect(components.tailwind.css).toBe("app/tokens.css");
    const base = tokens.css["@layer base"]!;
    for (const [selector, values] of Object.entries(base)) {
      for (const [name, value] of Object.entries(values)) {
        expect(tokensCss, `${selector} ${name}`).toMatch(
          new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*${name}: ${value.replace(/[()%.]/g, "\\$&")};`),
        );
      }
    }
    for (const [name, value] of Object.entries(tokens.cssVars.theme)) expect(tokensCss).toContain(`--${name}: ${value};`);
    // Nothing but the item: every name it declares is one the item names.
    const named = new Set([...Object.keys(tokens.cssVars.theme).map((n) => `--${n}`), ...Object.values(base).flatMap((v) => Object.keys(v))]);
    const declared = [...tokensCss.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!);
    expect(declared.filter((name) => !named.has(name))).toEqual([]);
  });

  it("takes the brand from the design system's one import, and restates no token", () => {
    expect(globals.split("\n").filter((line) => line === '@import "@flow-state-dev/design-system/shift-manager.css";')).toHaveLength(1);
    expect(globals.split("\n").filter((line) => line === '@import "./tokens.css";')).toHaveLength(1);
    expect(globals).not.toMatch(/token-defaults\.css/);
    // The item's names are the item's: the stylesheet restates none of them.
    const itemNames = [...Object.keys(tokens.cssVars.theme), ...Object.keys(tokens.css["@layer base"]![":root"]!).map((n) => n.slice(2))];
    expect(itemNames.filter((name) => new RegExp(`--${name}\\s*:`).test(globals))).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies["@flow-state-dev/design-system"]).toBe("workspace:*");
  });

  it("holds no copy of a brand value in its own source", () => {
    const values = themeValues(readFileSync(SHIFT_MANAGER_CSS, "utf8"));
    expect(values).toContain("#e8f551");
    for (const dir of ["app", "components", "lib", "flows"]) {
      expect(existsSync(join(appRoot, dir)), dir).toBe(true);
      expect(findThemeValues(join(appRoot, dir), values).hits, dir).toEqual([]);
    }
  });
});
