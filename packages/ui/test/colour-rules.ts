/**
 * The one definition of "a registry file paints only through tokens".
 *
 * Shared by the colour census (every registry file, no fixed colours) and the
 * reachability check (every file that reads a status token installs with the
 * `tokens` item). Both read registry files as source text on purpose: the
 * question is what the files a user copies in say, and importing them would
 * drag the renderer tree in to learn it.
 *
 * Productionized from the spec-time census the design-system spec kept as
 * evidence; this module, not that one, is what CI runs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A fixed Tailwind palette class, with or without a shade and an opacity
 * suffix: `text-amber-500`, `bg-green-500/10`, `text-white`.
 */
export const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|shadow|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:\/\d+)?\b/g;

/** A colour literal: hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()`. */
export const LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;

/** Fully transparent hex (`#0000`, `#00000000`) carries no colour a theme could change. */
const TRANSPARENT = /^#0{4}(?:0{4})?$/;

/** The status tokens this registry adds beside the existing semantic ones. */
export const STATUS_TOKENS = ["success", "warning", "info", "attention"] as const;

/**
 * Every semantic colour-token name a shadcn-style component could read. A
 * utility naming one of these, or any `*-foreground`, has to be defined by
 * the `tokens` item, or it renders with no colour in an app that installed
 * only what the registry shipped.
 */
const SEMANTIC_NAMES = new Set<string>([
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  ...STATUS_TOKENS,
]);

const COLOUR_UTILITY =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|border-[trblxy]|ring|ring-offset|outline|fill|stroke|from|to|via|divide|decoration|shadow|accent|caret|placeholder)-([a-z]+(?:-[a-z0-9]+)*?)(?:\/\d+)?(?![\w-])/g;

/** Every fixed colour in a source: palette classes and non-transparent literals, deduplicated. */
export function fixedColours(source: string): string[] {
  const literals = (source.match(LITERAL) ?? []).filter((m) => !TRANSPARENT.test(m));
  return [...new Set([...(source.match(PALETTE) ?? []), ...literals])];
}

/**
 * Corner classes that ignore the radius tokens. Tailwind's bare `rounded` is
 * a fixed 0.25rem; `rounded-sm` is the same size by default and reads
 * `--radius-sm`, so a theme can square it.
 */
export function fixedCorners(source: string): string[] {
  return source.match(/(?<![\w-])(?:[^\s"'`]*:)?rounded(?![\w-])/g) ?? [];
}

/** The semantic token names a source's colour utilities read (`text-attention` → `attention`). */
export function tokenUtilities(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(COLOUR_UTILITY)) {
    const name = match[1]!;
    if (SEMANTIC_NAMES.has(name) || name.endsWith("-foreground")) names.add(name);
  }
  return [...names];
}

/** Whether a source reads any status token, directly or through its `-foreground`. */
export function readsStatusToken(source: string): boolean {
  return tokenUtilities(source).some((name) =>
    STATUS_TOKENS.some((token) => name === token || name === `${token}-foreground`)
  );
}

/** Every registry source file under `dir`, stories excluded. Paths are absolute. */
export function registryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...registryFiles(full));
    else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(".stories.tsx")) out.push(full);
  }
  return out.sort();
}

/** The fixed colours in every file under `dir`, keyed by the file's path relative to `dir`. */
export function census(dir: string): { walked: string[]; offenders: Map<string, string[]> } {
  const walked = registryFiles(dir);
  const offenders = new Map<string, string[]>();
  for (const file of walked) {
    const hits = fixedColours(readFileSync(file, "utf8"));
    if (hits.length > 0) offenders.set(relative(dir, file), hits);
  }
  return { walked, offenders };
}

/**
 * The registry files a source imports by relative path, resolved against the
 * importing file and given an extension where the import left it off.
 */
export function relativeImports(file: string, source: string, exists: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const base = resolve(dirname(file), match[1]!);
    const candidates = [base, `${base}.tsx`, `${base}.ts`];
    out.push(candidates.find(exists) ?? base);
  }
  return out;
}
