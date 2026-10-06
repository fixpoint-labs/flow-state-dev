/**
 * Reading `shift-manager.css` and holding FSD's packages clear of it.
 *
 * The values are read from the stylesheet itself, never restated here, so a
 * value added to the theme is covered by the fence without editing a list.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package root, `labs/design-system`. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The monorepo root. */
export const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
/** The stylesheet an app imports. */
export const SHIFT_MANAGER_CSS = join(PACKAGE_ROOT, "shift-manager.css");

/**
 * `css` with its comments and `@import` statements removed: what is left is the
 * rules and their values, so an import path is never read as a selector or a
 * font family. Shared with the goals that read this stylesheet.
 */
export function stripImportsAndComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
}

/** Custom property → value, for one rule. */
export type Declarations = Record<string, string>;

/**
 * The declarations of every rule whose selector list is exactly `selectors`,
 * written with `, ` between selectors (`":root, .dark"`).
 */
export function rule(css: string, selectors: string): Declarations {
  const out: Declarations = {};
  const stripped = stripImportsAndComments(css);
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.split(",").map((s) => s.trim()).join(", ") !== selectors) continue;
    for (const decl of match[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[decl[1]!] = decl[2]!.trim();
  }
  return out;
}

/**
 * Every value in the stylesheet a copy of which would carry Shift Manager's look
 * into another package: colour literals (lowercased) and the quoted font
 * family names. Generic families (`ui-monospace`, `sans-serif`) are not ours
 * and not collected, and neither are the font imports' paths.
 */
export function themeValues(css: string): string[] {
  const stripped = stripImportsAndComments(css);
  const colours = (stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) => c.toLowerCase());
  const families = [...stripped.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return [...new Set([...colours, ...families])];
}

/** Directories never searched: dependencies and build output. */
const SKIP = new Set(["node_modules", "dist", "dist-client", "storybook-static", ".turbo", "coverage", ".next"]);

/** Every file under `dir`, skipping dependencies and build output. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (stat.size < 2_000_000) out.push(full);
  }
  return out;
}

/**
 * Every theme value found under `root`, as `<path relative to root>: <value>`.
 * One walk, every value tested against each file; colours match
 * case-insensitively, since `#E8F551` is the same colour.
 */
export function findThemeValues(root: string, values: readonly string[]): { walked: number; hits: string[] } {
  const files = walk(root);
  const matchers = values.map((value) => {
    const hex = value.startsWith("#") ? new RegExp(`${value.toLowerCase()}(?![0-9a-f])`) : null;
    return { value, found: (text: string, lower: string) => (hex ? hex.test(lower) : text.includes(value)) };
  });
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lower = text.toLowerCase();
    for (const { value, found } of matchers) {
      if (found(text, lower)) hits.push(`${relative(root, file)}: ${value}`);
    }
  }
  return { walked: files.length, hits };
}

/** An sRGB colour, 0 to 255 per channel. */
export type Rgb = [number, number, number];

/**
 * A `#rrggbb` or `hsl(h s% l%)` value as RGB: the two forms the design-system
 * stylesheet and the registry's `tokens` item write their colours in.
 */
export function toRgb(value: string): Rgb {
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hexMatch !== null) return [0, 2, 4].map((i) => parseInt(hexMatch[1]!.slice(i, i + 2), 16)) as Rgb;
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(value.trim());
  if (hsl === null) throw new Error(`not a #rrggbb or hsl() colour: ${value}`);
  const h = Number(hsl[1]) / 360;
  const s = Number(hsl[2]) / 100;
  const l = Number(hsl[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(v * 255);
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** Relative luminance (WCAG), 0 for black to 1 for white: what "darker than" compares. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
