#!/usr/bin/env node
/**
 * Brand lint for the docs: the diagrams (every `.svg` under `docs/`, `guides/` and
 * `blog/`) and `src/css/custom.css` keep to the Drafting System page register.
 *
 * - colour: every colour literal (hex, rgb()/rgba(), hsl()/hsla(), a CSS colour name)
 *   is one of page.css's token values — paper, the inks, the highlighter or red, in
 *   Paper or Night. A diagram should carry none at all: it reads the page's tokens.
 * - stroke: every stroke width is 1, 1.3 or 1.4 (diagrams, and page.css's drawing classes).
 * - dash: every dash pattern is `5 4`.
 * - info: `custom.css` never names `--info`, the app register's blue.
 * - font: no `<text>` (or anything around it) is set in a font other than the mono.
 *
 * Before linting the real files it lints `scripts/brand-lint-fixtures/`, which break
 * every rule on purpose, and fails unless each rule fires there: a rule that can no
 * longer fail is reported, not trusted.
 *
 * Usage: node scripts/lint-brand.mjs [file...]   (no files: the docs' own)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(DOCS, "scripts/brand-lint-fixtures");
const PAGE_CSS = createRequire(join(DOCS, "package.json")).resolve("@flow-state-dev/design-system/page.css");

const RULES = ["colour", "stroke", "dash", "info", "font"];
const STROKES = new Set(["1", "1.3", "1.4"]);
const DASHES = new Set(["5 4", "none"]);
const NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");
const COLOUR_PROPS = "color|background|background-color|border|border-color|border-(?:top|right|bottom|left)(?:-color)?|outline|outline-color|fill|stroke|stop-color|flood-color|text-decoration-color|box-shadow|scrollbar-color|caret-color";

/** `#abc` / `#aabbcc` / `rgb(…)` as a lowercase `#rrggbb` (alpha dropped: ink at any opacity is ink). */
function normalise(literal) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(literal);
  if (hex) {
    const h = hex[1].toLowerCase();
    const six = h.length <= 4 ? [...h.slice(0, 3)].map((c) => c + c).join("") : h.slice(0, 6);
    return `#${six}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(literal);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return literal.toLowerCase();
}

/** The colours page.css defines: its tokens' values, in both modes. */
function allowedColours() {
  const css = readFileSync(PAGE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
  return new Set(literals.map(normalise));
}

/** One finding: `file:line rule: detail`. */
function finding(file, text, index, rule, detail) {
  const line = text.slice(0, index).split("\n").length;
  return { file, line, rule, detail };
}

function lintColours(file, text, allowed, out) {
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
    // `url(#id)` and `href="#id"` are references, not colours.
    if (/(?:url\(|href=")$/.test(text.slice(Math.max(0, m.index - 5), m.index))) continue;
    const value = normalise(m[0]);
    if (m[0].startsWith("hsl") || !allowed.has(value)) out.push(finding(file, text, m.index, "colour", `${m[0]} is not a page token`));
  }
  const named = new RegExp(`(?:^|[\\s;{"'])(?:${COLOUR_PROPS})\\s*[:=]\\s*["']?([^;"'}\\n]*)`, "gi");
  for (const m of text.matchAll(named)) {
    for (const word of m[1].toLowerCase().split(/[\s,()]+/)) {
      if (NAMED.includes(word)) out.push(finding(file, text, m.index, "colour", `${word} is not a page token`));
    }
  }
}

function lintStrokes(file, text, out) {
  for (const m of text.matchAll(/stroke-width\s*[:=]\s*["']?([^;"'}\s]+)/g)) {
    const value = m[1].replace(/px$/, "");
    if (!STROKES.has(value)) out.push(finding(file, text, m.index, "stroke", `stroke-width ${m[1]} (1, 1.3 or 1.4 only)`));
  }
  for (const m of text.matchAll(/stroke-dasharray\s*[:=]\s*["']?([^;"'}]+)/g)) {
    const value = m[1].trim().replace(/\s*,\s*|\s+/g, " ");
    if (!DASHES.has(value)) out.push(finding(file, text, m.index, "dash", `stroke-dasharray ${m[1].trim()} (5 4 only)`));
  }
}

function lintFonts(file, text, out) {
  // In a diagram, any font family named anywhere (attribute, style attribute, <style>)
  // reaches its <text>. It must be the mono.
  for (const m of text.matchAll(/font-family\s*[:=]\s*["']?([^;"'}>]+)|font\s*:\s*([^;"'}]+)/g)) {
    const value = (m[1] ?? m[2]).trim();
    const family = m[1] ? value : value.replace(/^.*?\d+(?:\.\d+)?(?:px|em|rem|%)(?:\/\S+)?\s+/, "");
    const first = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (!/^(IBM Plex Mono|monospace|ui-monospace|var\(--font-mono\))$/i.test(first)) {
      out.push(finding(file, text, m.index, "font", `text set in ${first}, not IBM Plex Mono`));
    }
  }
}

/** Every finding for one file. */
function lintFile(file, allowed) {
  const text = readFileSync(file, "utf8");
  const out = [];
  if (file.endsWith(".svg")) {
    lintColours(file, text, allowed, out);
    lintStrokes(file, text, out);
    lintFonts(file, text, out);
  } else {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    lintColours(file, css, allowed, out);
    for (const m of css.matchAll(/--info\b/g)) out.push(finding(file, css, m.index, "info", "--info is the app register's blue"));
  }
  return out;
}

/** Drawing rules in page.css: strokes and dashes only (it defines the colours). */
function lintPageCss() {
  const out = [];
  lintStrokes(PAGE_CSS, readFileSync(PAGE_CSS, "utf8"), out);
  return out;
}

function svgsUnder(dir) {
  let files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) files = files.concat(svgsUnder(full));
      else if (entry.endsWith(".svg")) files.push(full);
    }
  } catch {
    // A missing directory has no diagrams.
  }
  return files;
}

const allowed = allowedColours();
const show = (f) => `${f.file.startsWith(DOCS) ? relative(DOCS, f.file) : f.file}:${f.line} ${f.rule}: ${f.detail}`;

// 1. The fixtures must trip every rule, or a rule has stopped working.
const fixtureFindings = readdirSync(FIXTURES).flatMap((f) => lintFile(join(FIXTURES, f), allowed));
const silent = RULES.filter((rule) => !fixtureFindings.some((f) => f.rule === rule));
if (silent.length) {
  console.error(`brand lint: no fixture failure for ${silent.join(", ")}; the rule can no longer fail.`);
  process.exit(1);
}

// 2. The real files.
const args = process.argv.slice(2);
const files = args.length
  ? args
  : [...["docs", "guides", "blog"].flatMap((d) => svgsUnder(join(DOCS, d))), join(DOCS, "src/css/custom.css")];
const findings = [...files.flatMap((f) => lintFile(f, allowed)), ...(args.length ? [] : lintPageCss())];
for (const f of findings) console.error(show(f));
console.log(`brand lint: ${files.length} files, ${findings.length} findings (fixtures trip all ${RULES.length} rules).`);
process.exit(findings.length ? 1 : 0);
