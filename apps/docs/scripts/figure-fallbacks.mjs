#!/usr/bin/env node
/**
 * The light-theme fallbacks a figure carries, read from page.css: what the brand lint checks (rules 2 and 4 of
 * `docs/contributing/user-docs-figures.md`), and a command that writes them.
 *
 * A figure draws through page.css's `.drawing` classes on the site, and off it (a file opened on its own, or on
 * GitHub) through the fallback attributes it carries: `fill`, `stroke`, `stroke-width`, `stroke-dasharray`,
 * `font-family`, `font-size`, `font-weight` and `letter-spacing`, each at the light (Paper) value page.css gives the
 * element's classes. `scripts/lint-brand.mjs` imports the reading half; the command is the writing half, so a figure
 * is drawn with classes only and given its fallbacks here rather than by hand.
 *
 *   node scripts/figure-fallbacks.mjs <figure.svg> [...]           print each figure with its fallbacks
 *   node scripts/figure-fallbacks.mjs --write <figure.svg> [...]   write them into each file
 *
 * Every element's fallback attributes are replaced by the ones its classes give (after its `class`, in the order
 * above), and removed where its classes give none; a hatch fill (`fill="url(#hatch)"`) on an element whose classes
 * set no fill is kept, and every other attribute keeps its value and its quotes. Text a class uppercases is not rewritten: it is reported, and the command exits 1, since SVG
 * has no attribute for it and the text is the author's to put in capitals.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The colour fallbacks (the lint's rule `colour`) and every fallback property, colours first (rule `fallback`). */
export const FALLBACK_COLOURS = ["fill", "stroke"];
export const FALLBACK_PROPS = [...FALLBACK_COLOURS, "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight", "letter-spacing"];

/** A value as an attribute carries it: whitespace collapsed, and double quotes as single (the attribute's are double). */
export const fallbackValue = (value) => value.trim().replace(/\s+/g, " ").replace(/"/g, "'");

/**
 * page.css's `.drawing` rules that set a fallback property, each with its light-theme values, every `var()` resolved
 * through `:root`: `{ tag, classes, not, specificity, [property]: value }`, in source order. A value that does not
 * resolve to a literal, a font stack that does not end in a generic family, or a selector this cannot read, throws:
 * the fallback a figure must carry would be a guess.
 */
export function readFallbackRules(pageCss) {
  const css = readFileSync(pageCss, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // The bare `:root` block is Paper, the light theme; Night's are `:root[…]` and `:root:not(…)`.
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  if (!root) throw new Error("page.css: no :root block to read the light theme from");
  const tokens = Object.fromEntries([...root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const literal = (prop, value, where) => {
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    const resolved = ref ? tokens[ref[1]] : value;
    if (resolved === undefined || /var\(|currentcolor|inherit|initial|unset/i.test(resolved)) {
      throw new Error(`page.css: ${where} is "${value}", which has no light-theme literal to check a fallback against`);
    }
    // Off the site the webfont is missing: the stack must end in a generic family, so the width text-fit assumes holds.
    if (prop === "font-family" && !/(?:^|,)\s*monospace$/.test(resolved)) {
      throw new Error(`page.css: ${where} is "${resolved}", which does not end in the generic monospace`);
    }
    return fallbackValue(resolved);
  };
  const property = new RegExp(`(?:^|;)\\s*(${[...FALLBACK_PROPS, "text-transform"].join("|")})\\s*:\\s*([^;]+)`, "g");
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = [...m[2].matchAll(property)];
    if (!decls.length) continue;
    for (const selector of m[1].split(",").map((s) => s.trim()).filter((s) => s.startsWith(".drawing "))) {
      const compound = /^\.drawing\s+([a-z]+)?((?:\.[\w-]+)*)(?::not\(([a-z]+)\))?$/.exec(selector);
      if (!compound) throw new Error(`page.css: cannot read the drawing selector "${selector}"`);
      const [, tag, classText, not] = compound;
      const classes = classText.split(".").filter(Boolean);
      const rule = { tag, classes, not, specificity: classes.length * 100 + (tag ? 1 : 0) + (not ? 1 : 0) };
      for (const [, prop, value] of decls) rule[prop] = literal(prop, value.trim(), `${selector} { ${prop} }`);
      rules.push(rule);
    }
  }
  return rules;
}

/** The light values `rules` give an element, by its name and classes, for each fallback property and text-transform. */
export function lightFallbacks(rules, name, classes) {
  const matching = rules.filter((r) => (!r.tag || r.tag === name) && r.classes.every((c) => classes.includes(c)) && r.not !== name);
  const out = {};
  for (const prop of [...FALLBACK_PROPS, "text-transform"]) {
    // The cascade: the highest specificity wins, and among equals the later rule (a stable sort keeps source order).
    const winner = matching.filter((r) => r[prop] !== undefined).sort((a, b) => a.specificity - b.specificity).at(-1);
    if (winner) out[prop] = winner[prop];
  }
  return out;
}

/** The page.css the docs site loads, as `apps/docs` resolves it. */
export const pageCssPath = () =>
  createRequire(join(dirname(fileURLToPath(import.meta.url)), "../package.json")).resolve("@flow-state-dev/design-system/page.css");

/**
 * `text` with every element's fallbacks set from `rules`; `capitals` lists the text a class uppercases that is not
 * written in capitals. Comments and CDATA are left as they are.
 */
export function withFallbacks(text, rules) {
  const capitals = [];
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)(\s*\/?)>([^<]*)/g;
  const out = text.replace(token, (whole, name, attrText, close, after) => {
    if (!name) return whole;
    const attrs = [...attrText.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3], a[2] === undefined ? "'" : '"']);
    const cls = (attrs.find(([k]) => k === "class")?.[1] ?? "").split(/\s+/).filter(Boolean);
    const light = lightFallbacks(rules, name, cls);
    const hatch = light.fill === undefined && attrs.some(([k, v]) => k === "fill" && v.trim() === "url(#hatch)");
    const kept = attrs.filter(([k]) => !FALLBACK_PROPS.includes(k) || (hatch && k === "fill"));
    const given = FALLBACK_PROPS.filter((p) => light[p] !== undefined).map((p) => [p, light[p], '"']);
    const at = kept.findIndex(([k]) => k === "class") + 1;
    const all = [...kept.slice(0, at), ...given, ...kept.slice(at)];
    // An entity (`&amp;`) is a character, not letters to put in capitals.
    const words = after.trim();
    const letters = words.replace(/&(?:#x[\da-f]+|#\d+|\w+);/gi, "");
    if (light["text-transform"] === "uppercase" && letters !== letters.toUpperCase()) capitals.push(`<${name} class="${cls.join(" ")}"> "${words}"`);
    return `<${name}${all.map(([k, v, q]) => ` ${k}=${q}${v}${q}`).join("")}${close}>${after}`;
  });
  return { text: out, capitals };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const files = args.filter((a) => a !== "--write");
  if (!files.length) {
    console.error("usage: node scripts/figure-fallbacks.mjs [--write] <figure.svg> [...]");
    process.exit(1);
  }
  const rules = readFallbackRules(pageCssPath());
  let failed = false;
  for (const file of files) {
    const { text, capitals } = withFallbacks(readFileSync(file, "utf8"), rules);
    if (write) writeFileSync(file, text);
    else process.stdout.write(text);
    for (const line of capitals) console.error(`${file}: ${line} is not in capitals: page.css uppercases it`);
    failed ||= capitals.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
