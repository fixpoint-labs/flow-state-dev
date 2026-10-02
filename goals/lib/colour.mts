/**
 * Colour arithmetic for goals that grade what a browser paints.
 *
 * Computed styles come back in several colour spaces (`rgb()`, `color(srgb …)`,
 * `oklab()`, `oklch()`); these turn each into sRGB so a painted colour can be
 * compared with a declared one. Also here: reading the custom properties a
 * stylesheet declares on one selector, and Shift Manager's theme values read from
 * the design-system package itself, so no goal restates them.
 *
 * Kept out of `index.mts`: only the goals that read a page's colours need it.
 *
 *   import { parseColour, near, readShiftManagerTheme } from "../../lib/colour.mts";
 */
import { readFileSync } from "node:fs";
import { repoPath } from "./paths.mts";

/** An sRGB colour, 0 to 255 per channel. */
export type Rgb = [number, number, number];

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function oklabToRgb(L: number, a: number, b: number): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    clamp(255 * gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(255 * gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(255 * gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

/**
 * A computed colour string as RGB plus alpha, or null when it is fully
 * transparent or not a colour. Alpha is kept apart: a `bg-success/10` tint is
 * still `success`.
 */
export function parseColour(value: string): { rgb: Rgb; alpha: number } | null {
  const nums = (s: string) =>
    s
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((n) => (n.endsWith("%") ? parseFloat(n) / 100 : n === "none" ? 0 : parseFloat(n)));
  let m: RegExpMatchArray | null;
  let rgb: Rgb;
  let alpha: number;
  if ((m = value.match(/^rgba?\(([^)]+)\)$/))) {
    const [r, g, b, a] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    rgb = [r!, g!, b!];
    alpha = a ?? 1;
  } else if ((m = value.match(/^color\(srgb ([^)]+)\)$/))) {
    const [r, g, b, a] = nums(m[1]!);
    rgb = [clamp(r! * 255), clamp(g! * 255), clamp(b! * 255)];
    alpha = a ?? 1;
  } else if ((m = value.match(/^oklab\(([^)]+)\)$/))) {
    const [L, a, b, al] = nums(m[1]!);
    rgb = oklabToRgb(L!, a!, b!);
    alpha = al ?? 1;
  } else if ((m = value.match(/^oklch\(([^)]+)\)$/))) {
    const [L, C, H, al] = nums(m[1]!);
    const h = (H! * Math.PI) / 180;
    rgb = oklabToRgb(L!, C! * Math.cos(h), C! * Math.sin(h));
    alpha = al ?? 1;
  } else {
    return null;
  }
  return alpha === 0 ? null : { rgb, alpha };
}

/** Whether two colours are the same to within 3 per channel. */
export const near = (a: Rgb, b: Rgb): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 3);

/** A colour as `#rrggbb`. */
export const hex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The custom properties `css` declares on exactly `selector` (comments and `@import`s ignored). */
export function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).join(", ") !== selector) continue;
    for (const d of m[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

/** Shift Manager's theme as the design-system package declares it. */
export interface ShiftManagerTheme {
  /** Every colour value per variant, as written (`#rrggbb`). */
  light: string[];
  dark: string[];
  /** The attention (highlighter) colour per variant. */
  attentionLight: string;
  attentionDark: string;
  /** The font families it names. */
  families: string[];
}

/** Read Shift Manager's values off `labs/design-system/shift-manager.css`. */
export function readShiftManagerTheme(): ShiftManagerTheme {
  const css = readFileSync(repoPath("labs/design-system/shift-manager.css"), "utf8");
  const light = declarations(css, ":root");
  const dark = declarations(css, ".dark");
  const colours = (d: Record<string, string>) => Object.values(d).filter((v) => /^#[0-9a-f]{3,8}$/i.test(v));
  return {
    light: colours(light),
    dark: colours(dark),
    attentionLight: light["--attention"]!,
    attentionDark: dark["--attention"]!,
    // The quoted names, leaving out the paths of the font imports.
    families: [...new Set([...css.replace(/@import[^;]*;/g, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!))],
  };
}
