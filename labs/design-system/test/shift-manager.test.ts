/**
 * Shift Manager's theme: complete in both variants, one highlighter, and fenced out
 * of FSD's packages.
 *
 * The fence reads its values from `shift-manager.css`, so a value added to the
 * theme is covered unedited. Its planted case copies one real package file to
 * a temp tree, adds one theme value, and shows the same search names it.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { registryTokenDefaults } from "../../../packages/ui/scripts/token-defaults";
import { SHIFT_MANAGER_CSS, PACKAGE_ROOT, REPO_ROOT, findThemeValues, luminance, rule, themeValues, toRgb } from "./theme";

const css = readFileSync(SHIFT_MANAGER_CSS, "utf8");
const light = rule(css, ":root");
const dark = rule(css, ".dark");
/** Evening sets only what differs from day; everything else it reads from day. */
const eveningOverrides = rule(css, ':root[data-shift=evening]');
const evening = { ...light, ...eveningOverrides };

/** The token names the registry's `tokens` item installs, as custom properties. */
function registryTokens(): string[] {
  return Object.keys(registryTokenDefaults().light).map((name) => `--${name}`);
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
    expect(light["--font-display"]).toMatch(/^"Space Grotesk"/);
    for (const [prop, value] of Object.entries(light)) if (prop.startsWith("--radius")) expect(value, prop).toBe("0");
  });

  it("imports a Latin face for every family it names, in every weight it is set in", () => {
    // A family named with nothing loading it falls back to the system font, silently.
    // That the faces load in a browser is the look goal's job; this keeps the imports honest.
    const require = createRequire(join(PACKAGE_ROOT, "package.json"));
    const imports = [...css.matchAll(/@import "([^"]+)";/g)].map((m) => m[1]!);
    const named = themeValues(css).filter((value) => !value.startsWith("#"));
    expect(named.sort()).toEqual(["IBM Plex Mono", "Space Grotesk"]);
    // Each import declares its face under the exact name the tokens use ("Space Grotesk", not
    // fontsource-variable's "Space Grotesk Variable"), or the named family still has no face.
    const declared = new Set(
      imports.flatMap((spec) => [...readFileSync(require.resolve(spec), "utf8").matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]!)),
    );
    expect([...declared].sort()).toEqual(named);
    expect(imports.sort()).toEqual([
      // 700 beyond the design's weights: highlighted code sets bold on some tokens.
      ...["400", "500", "600", "700"].map((w) => `@fontsource/ibm-plex-mono/latin-${w}.css`),
      ...["400", "500", "600", "700"].map((w) => `@fontsource/space-grotesk/latin-${w}.css`),
    ]);
  });

  it("points the navigator and panels at the tokens, in both variants", () => {
    const both = rule(css, ":root, .dark");
    expect(both["--fsd-nav-fg"]).toBe("var(--foreground)");
    expect(both["--fsd-panel-fg"]).toBe("var(--foreground)");
    for (const value of Object.values(both)) expect(value).toMatch(/^var\(--[a-z-]+\)$/);
  });
});

describe("evening", () => {
  it("overrides only tokens day sets, each as a hex colour", () => {
    expect(Object.keys(eveningOverrides).length).toBeGreaterThan(8);
    for (const [token, value] of Object.entries(eveningOverrides)) {
      expect(light[token], `${token} is a day token`).toBeDefined();
      expect(value, token).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("sits between day and night: a darker page than day, a lighter one than night", () => {
    const page = (variant: Record<string, string>) => luminance(toRgb(variant["--background"]!));
    expect(page(evening)).toBeLessThan(page(light));
    expect(page(evening)).toBeGreaterThan(page(dark));
  });

  it("keeps the ink and the highlighter day's", () => {
    for (const token of ["--foreground", "--attention", "--info", "--destructive"]) expect(eveningOverrides[token], token).toBeUndefined();
  });

  it("names each shift's own colour once, the same in every theme", () => {
    for (const shift of ["day", "evening", "night"]) {
      expect(light[`--shift-${shift}`], shift).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[`--shift-${shift}`], shift).toBeUndefined();
      expect(eveningOverrides[`--shift-${shift}`], shift).toBeUndefined();
    }
  });
});

describe("the two shell surfaces", () => {
  // Shift Manager's own names for v2's sidebar and inspector surfaces (v2:15-16): not registry
  // tokens, so the registry list above never covers them.
  const SURFACES = ["--sidebar", "--inspector"];
  const all = (variant: "light" | "dark") => Object.values(registryTokenDefaults()[variant]).map(toRgb);

  it("sets both in light and in dark, each darker than that variant's page", () => {
    for (const [name, variant] of [["light", light], ["evening", evening], ["dark", dark]] as const) {
      const page = luminance(toRgb(variant["--background"]!));
      for (const token of SURFACES) {
        expect(variant[token], `${token} (${name})`).toMatch(/^#[0-9a-f]{6}$/);
        expect(luminance(toRgb(variant[token]!)), `${token} (${name}) against --background`).toBeLessThan(page);
      }
    }
  });

  it("keeps each clear of every registry default, so the closure's leg c can tell skin from default", () => {
    // Leg c reads painted colours to within 3 per channel; a surface that close to a
    // neutral default would read as the default.
    for (const [name, variant] of [["light", light], ["evening", evening], ["dark", dark]] as const) {
      const defaults = [...all("light"), ...all("dark")];
      expect(defaults.length).toBeGreaterThan(40);
      for (const token of SURFACES) {
        const rgb = toRgb(variant[token]!);
        const close = defaults.filter((d) => d.every((v, i) => Math.abs(v - rgb[i]!) <= 3));
        expect(close, `${token} (${name}) ${variant[token]}`).toEqual([]);
      }
    }
    // Planted: a value one step off a registry default is caught by the same comparison.
    const planted = all("light")[0]!.map((v) => Math.min(255, v + 1));
    expect(all("light").some((d) => d.every((v, i) => Math.abs(v - planted[i]!) <= 3))).toBe(true);
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
  it("depends on nothing from FSD, Workforce included: only its fonts", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    const deps = { ...(manifest.dependencies as object), ...(manifest.peerDependencies as object) };
    expect(Object.keys(deps).sort()).toEqual(["@fontsource/ibm-plex-mono", "@fontsource/space-grotesk"]);
  });

  it("imports only its fonts and names no Workforce word in the stylesheet", () => {
    for (const [line] of css.matchAll(/@import[^;]*;/g)) expect(line).toMatch(/^@import "@fontsource\/[a-z-]+\/latin-\d+\.css";$/);
    expect(css).not.toMatch(/workforce|needs you|roster|seat/i);
  });
});
