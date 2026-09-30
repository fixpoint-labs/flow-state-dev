/**
 * The registry's token defaults, and a reader for a hand-kept stylesheet's copy.
 *
 * The `tokens` item in `registry.json` is where the neutral defaults are
 * authored. Two stylesheets keep their own copy in Tailwind's `@theme` form
 * rather than installing the item: Storybook's preview and kitchen-sink's
 * globals. Each asserts its copy against {@link registryTokenDefaults} so
 * the three can't drift apart.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Token name (no `--`, no `color-`) → value, for one variant. */
export type TokenValues = Record<string, string>;

const REGISTRY_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "../registry.json");

/** The `tokens` item's light and dark defaults, keyed by bare token name (`attention`). */
export function registryTokenDefaults(): { light: TokenValues; dark: TokenValues } {
  const manifest = JSON.parse(readFileSync(REGISTRY_JSON, "utf8")) as {
    items: Array<{ name: string; css?: { "@layer base"?: Record<string, Record<string, string>> } }>;
  };
  const base = manifest.items.find((item) => item.name === "tokens")?.css?.["@layer base"] ?? {};
  const bare = (block: Record<string, string> = {}) =>
    Object.fromEntries(Object.entries(block).map(([prop, value]) => [prop.replace(/^--/, ""), value]));
  return { light: bare(base[":root"]), dark: bare(base[".dark"]) };
}

/**
 * A stylesheet's `--color-*` values in its first block opened by `opener`
 * (`@theme {` for light, `.dark {` for dark), keyed by bare token name.
 */
export function stylesheetColours(css: string, opener: string): TokenValues {
  const start = css.indexOf(opener);
  if (start === -1) return {};
  const body = css.slice(start + opener.length, css.indexOf("}", start));
  const out: TokenValues = {};
  for (const match of body.matchAll(/--color-([a-z-]+)\s*:\s*([^;]+);/g)) out[match[1]!] = match[2]!.trim();
  return out;
}
