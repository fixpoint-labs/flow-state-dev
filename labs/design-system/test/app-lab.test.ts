/**
 * App Lab's theme: complete in both variants, one highlighter, and fenced out
 * of FSD's packages.
 *
 * The fence reads its values from `app-lab.css`, so a value added to the
 * theme is covered unedited. Its planted case copies one real package file to
 * a temp tree, adds one theme value, and shows the same search names it.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { APP_LAB_CSS, PACKAGE_ROOT, REPO_ROOT, findThemeValues, rule, themeValues } from "./theme";

const css = readFileSync(APP_LAB_CSS, "utf8");
const light = rule(css, ":root");
const dark = rule(css, ".dark");

/** The token names the registry's `tokens` item installs, as custom properties. */
function registryTokens(): string[] {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages/ui/registry.json"), "utf8")) as {
    items: Array<{ name: string; css?: { "@layer base"?: Record<string, Record<string, string>> } }>;
  };
  const tokens = manifest.items.find((item) => item.name === "tokens");
  return Object.keys(tokens?.css?.["@layer base"]?.[":root"] ?? {});
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("both variants", () => {
  const tokens = registryTokens();

  it("sets every registry token in light, and again in dark", () => {
    expect(tokens.length).toBeGreaterThan(20);
    for (const token of tokens) {
      expect(light[token], `${token} (light)`).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[token], `${token} (dark)`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives dark a different page, ink and every surface", () => {
    for (const token of ["--background", "--foreground", "--card", "--muted", "--border", "--primary"]) {
      expect(dark[token], token).not.toBe(light[token]);
    }
  });

  it("names the fonts and squares the corners", () => {
    expect(light["--font-sans"]).toMatch(/^"Space Grotesk"/);
    expect(light["--font-mono"]).toMatch(/^"IBM Plex Mono"/);
    expect(light["--font-display"]).toMatch(/^"Archivo"/);
    for (const [prop, value] of Object.entries(light)) if (prop.startsWith("--radius")) expect(value, prop).toBe("0");
  });

  it("points the navigator and panels at the tokens, in both variants", () => {
    const both = rule(css, ":root, .dark");
    expect(both["--fsd-nav-fg"]).toBe("var(--foreground)");
    expect(both["--fsd-panel-fg"]).toBe("var(--foreground)");
    for (const value of Object.values(both)) expect(value).toMatch(/^var\(--[a-z-]+\)$/);
  });
});

describe("one highlighter", () => {
  it("keeps attention apart from warning, light and dark", () => {
    expect(light["--attention"]).not.toBe(light["--warning"]);
    expect(dark["--attention"]).not.toBe(dark["--warning"]);
  });

  it("gives no other token the attention colour", () => {
    for (const variant of [light, dark]) {
      const others = Object.entries(variant).filter(
        ([prop, value]) => prop !== "--attention" && value === variant["--attention"]
      );
      expect(others).toEqual([]);
    }
  });
});

describe("the fence", () => {
  const values = themeValues(css);

  it("reads colours and font names from the stylesheet", () => {
    expect(values).toContain("#e8f551");
    expect(values).toContain("Space Grotesk");
    expect(values).not.toContain("ui-monospace");
  });

  it("finds no theme value anywhere under packages/", () => {
    const { walked, hits } = findThemeValues(join(REPO_ROOT, "packages"), values);
    expect(walked).toBeGreaterThan(500);
    expect(hits).toEqual([]);
  });

  it("names the file and value when one is planted in a package file", () => {
    const tree = mkdtempSync(join(tmpdir(), "fsd-fence-"));
    temps.push(tree);
    const copy = join(tree, "ui/registry/components/tool.tsx");
    cpSync(join(REPO_ROOT, "packages/ui/registry/components/tool.tsx"), copy);
    expect(findThemeValues(tree, values).hits).toEqual([]);
    writeFileSync(copy, `${readFileSync(copy, "utf8")}\nconst planted = "#E8F551";\n`);
    expect(findThemeValues(tree, values).hits).toEqual(["ui/registry/components/tool.tsx: #e8f551"]);
  });
});

describe("the package stays a skin", () => {
  it("depends on nothing from FSD, Workforce included", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    const deps = { ...(manifest.dependencies as object), ...(manifest.peerDependencies as object) };
    expect(Object.keys(deps)).toEqual([]);
  });

  it("imports nothing and names no Workforce word in the stylesheet", () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/workforce|needs you|roster|seat/i);
  });
});
