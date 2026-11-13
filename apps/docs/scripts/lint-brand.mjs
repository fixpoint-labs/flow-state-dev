#!/usr/bin/env node
/**
 * Brand lint for the docs: the diagrams (every `.svg` under `docs/`, `guides/` and
 * `blog/`) and `src/css/custom.css` keep to the Drafting System page register.
 *
 * - colour: in custom.css every colour literal is one of page.css's token values —
 *   paper, the inks, the highlighter or red, in Paper or Night — and no colour name or
 *   other colour function appears. A diagram carries no colour literal at all: it reads
 *   the page's tokens through page.css's drawing classes.
 * - stroke: every stroke width is 1, 1.3 or 1.4 (diagrams, and page.css's drawing classes).
 * - dash: every dash pattern is `5 4`.
 * - info: `custom.css` never names `--info`, the app register's blue.
 * - font: no `<text>` (or anything around it) is set in a font other than the mono.
 * - svg: a diagram has no `<title>`, `<desc>`, `<style>` or `style=` (the page and
 *   `<Figure>` own those), and uses only the drawing classes page.css defines.
 * - fill, attr, element: a diagram's only `fill` attribute is the hatch, it sets no
 *   stroke-width, dash or font by attribute, and it has no image, link, script, tspan,
 *   gradient, filter, opacity, text under a transform, `textLength`, DOCTYPE or ENTITY.
 *
 * A figure under `docs/contributing/docs-revamp/`, in any folder, and the figure fixtures, are
 * also held to the rest of the figure standard, `docs/contributing/user-docs-figures.md` →
 * "Lint rules", by its number:
 *
 * - defs (6), canvas (7), text-class (8), text-fit (9), arrow (10), key (11),
 *   key-marks (12), hatch (13), highlight (14), numbering (15).
 * - element (5, in full): no transform anywhere, and no dx, dy or rotate on text.
 * - embed (16): the revamp's pages (`pages/` and `pilot/`) put each figure on the page
 *   as a `<Figure svg caption description />` with a short caption and a full description. Pages
 *   are read with the MDX parser the site uses; one that does not parse fails.
 *
 * Before linting the real files it lints `scripts/brand-lint-fixtures/`, which break
 * every rule on purpose, and fails unless each rule fires there: a rule that can no
 * longer fail is reported, not trusted. Under `brand-lint-fixtures/figures/`, `<rule>.svg`
 * and `<rule>.<case>.svg` (or `.md`) must trip that rule, and `good.*` (`good.<case>.*`
 * included) must pass every rule.
 *
 * Usage: node scripts/lint-brand.mjs [file...]   (no files: the docs' own)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { createProcessor } from "@mdx-js/mdx";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(DOCS, "scripts/brand-lint-fixtures");
const PAGE_CSS = createRequire(join(DOCS, "package.json")).resolve("@flow-state-dev/design-system/page.css");
// The revamp's pages and figures, which the whole figure standard holds until cutover moves them onto the site.
const REVAMP = resolve(DOCS, "../../docs/contributing/docs-revamp");
const FIGURE_FIXTURES = join(FIXTURES, "figures");
// Where the whole figure standard holds, by path prefix. The site's published diagrams are not here: they keep rules 1 to 5 until cutover redraws them.
const HELD_TO_STANDARD = [REVAMP, FIGURE_FIXTURES];
// Drawn before the figure standard; FIX-2701 redraws them with their page and drops them from here.
const PREDATE_STANDARD = ["pages/blocks.md", "pages/figures/blocks.svg"].map((p) => join(REVAMP, p));

const RULES = [
  "colour", "stroke", "dash", "info", "font", "svg", "fill", "attr", "element",
  "defs", "canvas", "text-class", "text-fit", "arrow", "key", "key-marks", "hatch", "highlight", "numbering", "embed",
];
const STROKES = new Set(["1", "1.3", "1.4"]);
const DASHES = new Set(["5 4", "none"]);
const NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");

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

/**
 * Colour literals. In a diagram any literal fails: it would draw one mode's value in
 * both, where the page's tokens follow the mode. In CSS a hex or rgb() must be a token
 * value, and every other colour function (hsl, oklch, lab, hwb, color()…) fails.
 */
function lintColours(file, text, allowed, out) {
  const svg = file.endsWith(".svg");
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\([^)]*\)/g;
  for (const m of text.matchAll(literal)) {
    // `url(#id)` and `href="#id"` are references, not colours.
    if (/(?:url\(|href=")$/.test(text.slice(Math.max(0, m.index - 6), m.index))) continue;
    const tokenValue = /^(?:#|rgb)/i.test(m[0]) && allowed.has(normalise(m[0]));
    if (svg || !tokenValue) out.push(finding(file, text, m.index, "colour", `${m[0]} is not read from a page token`));
  }
  // Colour names: in CSS, in any declaration's value (custom properties included); in a
  // diagram, in any attribute or style value.
  const values = svg ? /([\w-]+)\s*[=:]\s*["']?([^;"'<>]+)/g : /([\w-]+)\s*:\s*([^;{}]+)/g;
  for (const m of text.matchAll(values)) {
    for (const word of m[2].toLowerCase().split(/[\s,()]+/)) {
      if (NAMED.includes(word)) out.push(finding(file, text, m.index, "colour", `${word} (in ${m[1]}) is not a page token`));
    }
  }
}

/** A diagram is drawing only: no title, description or styling of its own, and only page.css's drawing classes. */
function lintSvgShape(file, text, drawingClasses, out) {
  for (const m of text.matchAll(/<(title|desc|style)\b|\sstyle\s*=/g)) {
    out.push(finding(file, text, m.index, "svg", `${m[1] ? `<${m[1]}>` : "a style attribute"}: the page and <Figure> own it`));
  }
  for (const m of text.matchAll(/\sclass\s*=\s*["']([^"']*)["']/g)) {
    for (const name of m[1].split(/\s+/).filter(Boolean)) {
      if (!drawingClasses.has(name)) out.push(finding(file, text, m.index, "svg", `class "${name}" is not a drawing class in page.css`));
    }
  }
}

/** The class names page.css's `.drawing` rules define. */
function drawingClassNames() {
  const css = readFileSync(PAGE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.drawing\s+(?:[a-z]+)?\.([a-z][\w-]*)/g)].map((m) => m[1]));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** XML's character references and five named entities as the characters they stand for; any other `&name;` is left as written. */
const decodeEntities = (s) =>
  s.replace(/&(?:#x([\da-f]+)|#(\d+)|(\w+));/gi, (ref, hex, dec, named) =>
    hex || dec ? String.fromCodePoint(parseInt(hex ?? dec, hex ? 16 : 10)) : (ENTITIES[named] ?? ref),
  );

/** A diagram as a tree of `{ name, attrs, children, text, index, parent }`: enough XML for a drawing. */
function parseSvg(text) {
  const root = { name: "#root", attrs: {}, children: [], text: "", index: 0 };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of text.matchAll(token)) {
    const [, cdata, close, name, attrText, selfClose, chars] = m;
    const top = stack[stack.length - 1];
    // CDATA is character data, kept as written; other text has its entities decoded.
    if (cdata !== undefined) top.text += cdata;
    else if (chars !== undefined) top.text += decodeEntities(chars);
    else if (close) {
      if (stack.length > 1) stack.pop();
    } else if (name) {
      const attrs = Object.fromEntries(
        [...attrText.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3]]),
      );
      const node = { name, attrs, children: [], text: "", index: m.index, parent: top };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    }
  }
  return root;
}

const descendants = (node) => node.children.flatMap((c) => [c, ...descendants(c)]);
const classesOf = (node) => (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
/** A coordinate or length: a plain number or one in px; NaN for anything else, which `lintFigure` reports. */
const num = (node, attr) => {
  const value = (node.attrs[attr] ?? "0").trim();
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value) ? parseFloat(value) : NaN;
};
const GEOMETRY = ["x", "y", "width", "height", "x1", "y1", "x2", "y2"];
/** A text element's characters as they render: entities decoded by `parseSvg`, CDATA as written. */
const content = (node) => node.text.trim();
function within(node, test) {
  for (let p = node.parent; p; p = p.parent) if (test(p)) return true;
  return false;
}
const holds = (box, x, y) =>
  x >= num(box, "x") && x <= num(box, "x") + num(box, "width") && y >= num(box, "y") && y <= num(box, "y") + num(box, "height");

/** Rules 2, 4 and 5 of the figure standard, which every diagram keeps: fills, attributes, elements. */
function lintSvgAttributes(file, text, tree, out) {
  const BANNED = /^(?:image|foreignObject|a|script|tspan|linearGradient|radialGradient|filter)$/;
  // An entity can hide any markup (a <script> included) from this lint's parser, and SVGO expands it on the site.
  for (const m of text.matchAll(/<!(DOCTYPE|ENTITY)\b/gi)) {
    out.push(finding(file, text, m.index, "element", `<!${m[1]}> has no place in a drawing: its entities can carry markup the lint never sees`));
  }
  for (const node of descendants(tree)) {
    const at = (rule, detail) => out.push(finding(file, text, node.index, rule, detail));
    if (node.attrs.fill !== undefined && node.attrs.fill !== "url(#hatch)") {
      at("fill", `fill="${node.attrs.fill}": the only fill attribute is the hatch; a fill comes from hl, ground, ink or x-fill`);
    }
    for (const attr of ["stroke-width", "stroke-dasharray", "font-family"]) {
      if (node.attrs[attr] !== undefined) at("attr", `a ${attr} attribute: the drawing classes set it`);
    }
    if (BANNED.test(node.name)) at("element", `<${node.name}> has no place in a drawing`);
    for (const attr of ["opacity", "fill-opacity", "stroke-opacity", "filter", "textLength"]) {
      if (node.attrs[attr] !== undefined) at("element", `a ${attr} attribute has no place in a drawing`);
    }
    if (node.name === "text" && (node.attrs.transform !== undefined || within(node, (p) => p.attrs.transform !== undefined))) {
      at("element", "a transform on text or a group around it: text never rotates");
    }
  }
}

// The figure standard's `<defs>`, exactly; whitespace between tags is free.
const DEFS_TEXT = `<defs>
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="5"/></pattern>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ink" d="M0,0 L10,5 L0,10 z"/></marker>
</defs>`;
/** A parsed element as one string: its name, its attributes in order, its trimmed text and its children's. */
const shape = (node) =>
  `<${node.name}${Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join("")}>${node.text.trim()}${node.children.map(shape).join("")}</${node.name}>`;
const DEFS = shape(parseSvg(DEFS_TEXT).children[0]);
// Each text class, and its width in units per character.
const UNITS = { lb: 7.5, nm: 9, sub: 6.3, c: 7.5, t: 7.2, n: 6.6, plate: 7.3 };
const BOXES = new Set(["solid", "thin", "dash"]);

/** The mark a shape draws, as the key names it: hatch, dash, hl, ln, ln-dash or x (red); null for none. */
function markOf(node) {
  const cls = classesOf(node);
  if (node.attrs.fill === "url(#hatch)") return "hatch";
  if (cls.includes("x") || cls.includes("x-fill")) return "x";
  if (cls.includes("ln-dash")) return "ln-dash";
  if (cls.includes("ln") && (node.attrs["marker-end"] || node.attrs["marker-start"])) return "ln";
  if (cls.includes("dash")) return "dash";
  if (cls.includes("hl")) return "hl";
  return null;
}
// The element a key sample for each mark is, and what its label must say.
const SAMPLE = { hatch: "rect", dash: "line", hl: "rect", ln: "line", "ln-dash": "line", x: "line" };
const LABEL = {
  hatch: [(l) => l === "OUTLIVES THE REQUEST", "must be exactly OUTLIVES THE REQUEST"],
  dash: [(l) => l === "LASTS ONE ACTION RUN", "must be exactly LASTS ONE ACTION RUN"],
  hl: [(l) => l.split(/\s+/).length <= 5, "must be five words or fewer"],
  "ln-dash": [(l) => /^ONLY\b/.test(l), "must start with ONLY"],
};

/** Rules 6 to 15 of the figure standard, for a figure it holds: defs, canvas, text, arrows, key, marks. */
function lintFigure(file, text, tree, out) {
  const svg = tree.children.find((n) => n.name === "svg");
  if (!svg) {
    out.push(finding(file, text, 0, "canvas", "no <svg> root"));
    return;
  }
  const at = (node, rule, detail) => out.push(finding(file, text, node.index, rule, detail));
  const all = descendants(svg);
  const keys = all.filter((n) => n.attrs.id === "key");
  const drawing = all.filter((n) => n.attrs.id !== "key" && !within(n, (p) => p.attrs.id === "key" || p.name === "defs"));
  const rects = drawing.filter((n) => n.name === "rect");
  const same = (a, b) => ["x", "y", "width"].every((k) => num(a, k) === num(b, k));

  // 6. The two definitions, as printed.
  const defs = all.filter((n) => n.name === "defs");
  if (defs.length !== 1 || shape(defs[0]) !== DEFS) {
    at(defs[0] ?? svg, "defs", "<defs> is not exactly the hatch pattern and the ah marker the standard prints");
  }

  // 7. The canvas.
  if (!/^0 0 920 \d+$/.test(svg.attrs.viewBox ?? "")) {
    at(svg, "canvas", `viewBox "${svg.attrs.viewBox ?? ""}" is not 0 0 920 H with a whole-number H`);
  }
  for (const attr of ["width", "height"]) if (svg.attrs[attr] !== undefined) at(svg, "canvas", `the root has a ${attr}; the page sizes it`);
  // Every geometry check reads these; one it cannot read is reported, never skipped.
  for (const node of all) {
    // One canvas: a nested <svg> is a new viewport, so the coordinates inside it are not the canvas's.
    if (node.name === "svg") at(node, "element", "a nested <svg>: a figure is one canvas, drawn in its coordinates");
    // A figure is drawn in canvas coordinates: a transform would move a shape away from the coordinates every check reads.
    if (node.attrs.transform !== undefined || /(?:^|;)\s*transform\s*:/.test(node.attrs.style ?? "")) {
      at(node, "element", `a transform on <${node.name}>: a figure is drawn in canvas coordinates and takes no transforms`);
    }
    // Text sits where its x and y say; an offset or per-glyph position is not checked, so it is not allowed.
    if (node.name === "text" || node.name === "tspan") {
      for (const attr of ["dx", "dy", "rotate"].filter((a) => node.attrs[a] !== undefined)) {
        at(node, "text-fit", `a ${attr} attribute on <${node.name}>: text is placed by one x and one y only`);
      }
    }
    for (const attr of GEOMETRY.filter((a) => node.attrs[a] !== undefined && Number.isNaN(num(node, a)))) {
      at(node, "canvas", `${attr}="${node.attrs[attr]}" is not a number in canvas units (unitless or px)`);
    }
  }

  for (const node of all.filter((n) => n.name === "text")) {
    // 8. One text class, plus on-hl or x; lb and plate in capitals.
    const cls = classesOf(node);
    const kinds = cls.filter((c) => c in UNITS);
    if (kinds.length !== 1 || cls.some((c) => !(c in UNITS) && c !== "on-hl" && c !== "x")) {
      at(node, "text-class", `text class "${cls.join(" ")}" is not one of ${Object.keys(UNITS).join(", ")}, plus on-hl or x`);
      continue;
    }
    const kind = kinds[0];
    const words = content(node);
    if ((kind === "lb" || kind === "plate") && words !== words.toUpperCase()) at(node, "text-class", `${kind} text "${words}" is not in capitals`);

    // 9. It fits: the line runs from x=28 to x=892, and 12 inside both edges of its box.
    const width = [...words].length * UNITS[kind];
    const x = num(node, "x");
    // The anchor inherits as SVG's does: the nearest one on the text or a group around it, start by default.
    const chain = [];
    for (let p = node; p; p = p.parent) if (p.attrs["text-anchor"] !== undefined) chain.push(p.attrs["text-anchor"]);
    for (const value of chain.filter((v) => !["start", "middle", "end"].includes(v))) {
      at(node, "text-fit", `text-anchor="${value}" is not start, middle or end, so the line's extent cannot be checked`);
    }
    const start = x - ({ middle: width / 2, end: width }[chain[0]] ?? 0);
    const end = start + width;
    if (start < 28) at(node, "text-fit", `"${words}" starts at x=${start.toFixed(1)}, inside the 28 left margin`);
    if (end > 892) at(node, "text-fit", `"${words}" ends at x=${end.toFixed(1)}, past 892`);
    // Its box: the smallest that holds where the line starts, or else the smallest its rendered span overlaps.
    const y = num(node, "y");
    const boxes = all
      .filter((r) => r.name === "rect" && classesOf(r).some((c) => BOXES.has(c)) && y >= num(r, "y") && y <= num(r, "y") + num(r, "height"))
      .sort((a, b) => num(a, "width") * num(a, "height") - num(b, "width") * num(b, "height"));
    const box =
      boxes.find((r) => holds(r, start, y)) ?? boxes.find((r) => start < num(r, "x") + num(r, "width") && end > num(r, "x"));
    if (box && start < num(box, "x") + 12) {
      at(node, "text-fit", `"${words}" starts at x=${start.toFixed(1)}, less than 12 inside its box's left edge at ${num(box, "x")}`);
    }
    if (box && end > num(box, "x") + num(box, "width") - 12) {
      at(node, "text-fit", `"${words}" ends at x=${end.toFixed(1)}, less than 12 inside its box's right edge at ${num(box, "x") + num(box, "width")}`);
    }
  }

  // 10. Arrows run horizontally or vertically.
  for (const node of all.filter((n) => classesOf(n).some((c) => c === "ln" || c === "ln-dash"))) {
    const straight =
      node.name === "line"
        ? num(node, "x1") === num(node, "x2") || num(node, "y1") === num(node, "y2")
        : node.name === "path" && /^\s*M\s*-?[\d.]+[\s,]+-?[\d.]+(?:\s*[HV]\s*-?[\d.]+)*\s*$/.test(node.attrs.d ?? "");
    if (!straight) at(node, "arrow", `a <${node.name}> arrow that is not horizontal or vertical: a <line>, or a <path> of M, H and V`);
  }

  // 11. One key, the last element, of entries that are one sample and one lb label.
  const key = keys[0];
  if (keys.length !== 1 || key.name !== "g") at(key ?? svg, "key", `${keys.length} key elements: a figure has exactly one <g id="key">`);
  else if (svg.children.at(-1) !== key) at(key, "key", "the key is not the figure's last element");
  const entries = [];
  let samples = [];
  for (const node of key?.children ?? []) {
    if (node.name !== "text") samples.push(node);
    else if (!classesOf(node).includes("lb") || !samples.length) at(node, "key", `key label "${content(node)}" is not one lb label after a sample`);
    else {
      // A hatched sample is two rects: the hatch, and the thin outline that closes it.
      const hatched = samples.length === 2 && markOf(samples[0]) === "hatch" && classesOf(samples[1]).includes("thin") && same(samples[0], samples[1]);
      if (samples.length !== 1 && !hatched) at(samples[0], "key", `key entry "${content(node)}" has ${samples.length} samples, not one`);
      entries.push({ sample: samples[0], label: content(node) });
      samples = [];
    }
  }
  if (samples.length) at(samples[0], "key", "a key sample with no label after it");

  // 12. The key lists every mark the drawing uses, and only those, in the standard's words.
  const used = new Set(drawing.map(markOf).filter(Boolean));
  const listed = new Set();
  for (const { sample, label } of entries) {
    const mark = markOf(sample);
    if (!mark) {
      at(sample, "key-marks", `key entry "${label}" shows no mark`);
      continue;
    }
    listed.add(mark);
    if (sample.name !== SAMPLE[mark]) at(sample, "key-marks", `the ${mark} sample is a <${sample.name}>, not a <${SAMPLE[mark]}>`);
    if (!used.has(mark)) at(sample, "key-marks", `key entry "${label}" is for ${mark}, which the drawing does not use`);
    const [ok, must] = LABEL[mark] ?? [];
    if (ok && !ok(label)) at(sample, "key-marks", `the ${mark} label "${label}" ${must}`);
  }
  for (const mark of used) if (!listed.has(mark)) at(key ?? svg, "key-marks", `the drawing uses ${mark}, and the key has no entry for it`);

  // 13. Hatching is a band 10 tall on a solid or thin box, never on a dashed one.
  for (const node of drawing.filter((n) => markOf(n) === "hatch")) {
    const onBox = (cls) => rects.some((r) => r !== node && same(r, node) && classesOf(r).some((c) => cls.includes(c)));
    if (node.name !== "rect" || num(node, "height") !== 10 || !onBox(["solid", "thin"]) || onBox(["dash"])) {
      at(node, "hatch", "hatching that is not a band 10 tall sharing x, y and width with a solid or thin box");
    }
  }

  // 14. One highlighter, and on-hl only on text over it.
  const hl = drawing.filter((n) => classesOf(n).includes("hl"));
  for (const node of hl.slice(1)) at(node, "highlight", `${hl.length} highlighted shapes: a figure has one`);
  for (const node of all.filter((n) => n.name === "text" && classesOf(n).includes("on-hl"))) {
    if (!hl.some((r) => holds(r, num(node, "x"), num(node, "y")))) at(node, "highlight", `on-hl text "${content(node)}" is not over the highlighter`);
  }

  // 15. One numbering: notes count up from 01, each numbered plate has its note, and no layer numbers beside notes.
  const texts = drawing.filter((n) => n.name === "text");
  const noteNodes = texts.filter((n) => classesOf(n).includes("n"));
  const notes = noteNodes.map(content);
  notes.forEach((note, i) => {
    const next = String(i + 1).padStart(2, "0");
    if (note !== next) at(noteNodes[i], "numbering", `note "${note}" where ${next} comes next`);
  });
  for (const node of texts.filter((n) => classesOf(n).includes("plate") && /^\d+$/.test(content(n)))) {
    if (!notes.includes(content(node))) at(node, "numbering", `plate ${content(node)} has no note ${content(node)}`);
  }
  if (notes.length) {
    for (const node of texts.filter((n) => /^\d+\s*·/.test(content(n)))) at(node, "numbering", `"${content(node)}" numbers a layer in a figure with numbered notes`);
  }
}

/** Every node of an mdast or estree tree, depth first; position data is not walked. */
function* walk(node) {
  if (!node || typeof node.type !== "string") return;
  yield node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "position" || key === "loc" || key === "range") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === "object") yield* walk(key === "data" ? child.estree : child);
    }
  }
}

// The parser Docusaurus runs on a page (`markdown.format` is mdx by default).
const MDX = createProcessor({ format: "mdx" });

/**
 * Rule 16: a page puts each figure on through `<Figure svg caption description />`, and nothing else. The page is
 * read as the site reads it, as MDX, so code blocks and inline code are not markup and a page that does not parse
 * is a finding.
 */
function lintFigureEmbeds(file, text, out) {
  const at = (line, detail) => out.push({ file, line, rule: "embed", detail });
  // Docusaurus takes the frontmatter off before MDX sees the page; blanking it keeps the lines.
  const body = text.replace(/^---\n[\s\S]*?\n---(?=\n|$)/, (fm) => fm.replace(/[^\n]/g, " "));
  let tree;
  try {
    tree = MDX.parse(body);
  } catch (err) {
    at(err.line ?? err.place?.line ?? 1, `the page does not parse as MDX: ${err.reason ?? err.message}`);
    return;
  }
  const nodes = [...walk(tree)];
  const lineOf = (node, fallback) => node.loc?.start.line ?? node.position?.start.line ?? fallback;

  // The SVGs the page imports, by the name it binds each to.
  const svgs = new Set();
  for (const node of nodes.filter((n) => n.type === "ImportDeclaration" && /\.svg$/.test(n.source.value))) {
    for (const specifier of node.specifiers) svgs.add(specifier.local.name);
  }

  const image = (line) => at(line, "a figure set as an image: use <Figure svg caption description />");
  const definitions = new Map(nodes.filter((n) => n.type === "definition").map((n) => [n.identifier, n.url]));
  for (const node of nodes) {
    const line = lineOf(node, 1);
    if (node.type === "image" && /\.svg\b/.test(node.url)) image(line);
    if (node.type === "imageReference" && /\.svg\b/.test(definitions.get(node.identifier) ?? "")) image(line);
    if (node.type === "text" && node.value.includes("Description for the site's")) {
      at(line, "a note about how the figure will be embedded: the description goes in <Figure>");
    }
  }

  // Every element, in Markdown (mdxJsx*Element) or inside an expression (JSXElement), as a name and its
  // attributes: `{ name, value }`, with value a string, an estree expression, or null for a bare attribute.
  const elements = [];
  for (const node of nodes) {
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const attrs = node.attributes
        .filter((a) => a.type === "mdxJsxAttribute")
        .map((a) => ({ name: a.name, value: typeof a.value === "string" ? a.value : (a.value?.data?.estree.body[0]?.expression ?? null) }));
      elements.push({ name: node.name, attrs, line: lineOf(node, 1) });
    } else if (node.type === "JSXElement") {
      const open = node.openingElement;
      const attrs = open.attributes
        .filter((a) => a.type === "JSXAttribute")
        .map((a) => ({ name: a.name.name, value: a.value?.type === "Literal" ? a.value.value : (a.value?.expression ?? null) }));
      elements.push({ name: open.name.name, attrs, line: lineOf(node, 1) });
    }
  }

  const stringOf = (value) =>
    typeof value === "string" ? value
    : value?.type === "Literal" && typeof value.value === "string" ? value.value
    : value?.type === "TemplateLiteral" && !value.expressions.length ? value.quasis[0].value.cooked
    : null;
  // The one allowed use of an imported SVG: the whole svg value of a <Figure>.
  const allowed = new Set();
  for (const { name, attrs, line } of elements) {
    if (svgs.has(name)) at(line, `${name} is used outside a <Figure>'s svg: use <Figure svg={${name}} caption description />`);
    if (name === "img" && /\.svg\b/.test(stringOf(attrs.find((a) => a.name === "src")?.value) ?? "")) image(line);
    if (name === "svg") at(line, "an inline <svg> on the page: a figure is its own file, put on through <Figure svg={…} />");
    if (name !== "Figure") continue;
    const prop = (key) => attrs.find((a) => a.name === key)?.value;
    const svg = prop("svg");
    if (svg?.type === "Identifier") allowed.add(svg);
    const caption = stringOf(prop("caption"));
    const words = stringOf(prop("description"))?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    if (!svg || typeof svg === "string") at(line, "<Figure> has no svg");
    if (caption === null) at(line, "<Figure> has no caption");
    else if (caption.length > 60 || caption.endsWith(".")) at(line, `caption "${caption}" is over 60 characters or ends in a full stop`);
    if (words < 30) at(line, `the description is ${words} words: it says what the whole figure shows in 30 or more`);
  }
  // Any other reference to an imported SVG, in any expression, attribute or export. An import's own names declare, not use.
  const declared = new Set(nodes.filter((n) => n.type === "ImportDeclaration").flatMap((n) => [...walk(n)]));
  for (const node of nodes) {
    if (node.type === "Identifier" && svgs.has(node.name) && !allowed.has(node) && !declared.has(node)) {
      at(lineOf(node, 1), `${node.name} is used outside a <Figure>'s svg: use <Figure svg={${node.name}} caption description />`);
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

const inside = (dir, file) => !relative(dir, resolve(file)).startsWith("..");
/** Whether the whole figure standard holds a diagram: any one under a `HELD_TO_STANDARD` prefix, whatever its folder is called. */
const heldToStandard = (file) => HELD_TO_STANDARD.some((dir) => inside(dir, file));

/** Every finding for one file: a diagram, a page (`.md`, `.mdx`) or a stylesheet. */
function lintFile(file, allowed) {
  const text = readFileSync(file, "utf8");
  const out = [];
  if (/\.mdx?$/.test(file)) {
    lintFigureEmbeds(file, text, out);
  } else if (file.endsWith(".svg")) {
    const tree = parseSvg(text);
    lintSvgShape(file, text, DRAWING_CLASSES, out);
    lintColours(file, text, allowed, out);
    lintStrokes(file, text, out);
    lintFonts(file, text, out);
    lintSvgAttributes(file, text, tree, out);
    if (heldToStandard(file)) lintFigure(file, text, tree, out);
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
  } catch (err) {
    // A missing directory has no diagrams; any other failure must not skip a tree silently.
    if (err?.code !== "ENOENT") throw err;
  }
  return files;
}

const allowed = allowedColours();
const DRAWING_CLASSES = drawingClassNames();
const show = (f) => `${f.file.startsWith(DOCS) ? relative(DOCS, f.file) : f.file}:${f.line} ${f.rule}: ${f.detail}`;

// 1. The fixtures must trip every rule, or a rule has stopped working. A figure fixture
// `<rule>.svg` or `<rule>.<case>.svg` (or `.md`) must trip its own rule, and `good.*` none: a
// rule that fires on a clean figure would fail every figure for nothing.
const fixtures = [
  ...readdirSync(FIXTURES).map((f) => join(FIXTURES, f)).filter((f) => statSync(f).isFile()),
  ...readdirSync(FIGURE_FIXTURES).map((f) => join(FIGURE_FIXTURES, f)),
];
const fixtureFindings = fixtures.map((file) => ({ file, found: lintFile(file, allowed) }));
const broken = [];
for (const { file, found } of fixtureFindings.filter((f) => inside(FIGURE_FIXTURES, f.file))) {
  const rule = relative(FIGURE_FIXTURES, file).split(".")[0];
  if (rule === "good") broken.push(...found.map((f) => `the clean fixture fails ${show(f)}`));
  else if (!RULES.includes(rule)) broken.push(`${relative(DOCS, file)} names no rule`);
  else if (!found.some((f) => f.rule === rule)) broken.push(`${relative(DOCS, file)} does not trip ${rule}`);
}
const silent = RULES.filter((rule) => !fixtureFindings.some((f) => f.found.some((x) => x.rule === rule)));
if (silent.length) broken.push(`no fixture failure for ${silent.join(", ")}; the rule can no longer fail.`);
if (broken.length) {
  for (const line of broken) console.error(`brand lint: ${line}`);
  process.exit(1);
}

// 2. The real files: the site's diagrams and custom.css, and the revamp's figures and pages.
const args = process.argv.slice(2);
const pagesIn = (dir) =>
  readdirSync(join(REVAMP, dir))
    .filter((f) => /\.mdx?$/.test(f) && !/\.(record|facts)\.md$/.test(f))
    .map((f) => join(REVAMP, dir, f));
const revamp = [...svgsUnder(REVAMP), ...["pages", "pilot"].flatMap(pagesIn)];
const stale = PREDATE_STANDARD.filter((f) => !revamp.includes(f));
if (!args.length && stale.length) {
  // An exemption for a file that is gone would quietly exempt whatever takes its name.
  console.error(`brand lint: exempt from the figure standard, and gone: ${stale.map((f) => relative(REVAMP, f)).join(", ")}`);
  process.exit(1);
}
const files = args.length
  ? args
  : [
      ...["docs", "guides", "blog"].flatMap((d) => svgsUnder(join(DOCS, d))),
      join(DOCS, "src/css/custom.css"),
      ...revamp.filter((f) => !PREDATE_STANDARD.includes(f)),
    ];
const findings = [...files.flatMap((f) => lintFile(f, allowed)), ...(args.length ? [] : lintPageCss())];
for (const f of findings) console.error(show(f));
console.log(`brand lint: ${files.length} files, ${findings.length} findings (fixtures trip all ${RULES.length} rules).`);
process.exit(findings.length ? 1 : 0);
