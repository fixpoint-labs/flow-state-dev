/**
 * The figure lint's failing fixtures, as edits to its clean ones: each case takes `figures/<base>`, replaces each
 * `find` with its `replace` (a string, or two arrays of the same length for several edits), and must then trip
 * `rule`. `scripts/lint-brand.mjs` applies them in memory as `figures/<name>.<svg|md>` and fails if a `find` is not
 * in its base (an edit that no longer applies would otherwise pass for nothing) or if the case does not trip its rule.
 */

// Lines of figures/good.svg that the cases edit.
const NAME = '<text class="c" fill="#1b1a15" x="452" y="56">board.drain</text>';
const LABEL = '<text class="lb" fill="#57544a" x="42" y="56">TASKS &amp; RUNS</text>';
const DASH_BOX = '<rect class="dash" fill="none" stroke="#1b1a15" x="438" y="24" width="300" height="80"/>';
const NOTE = '<text class="n" fill="#1b1a15" x="28" y="154">01</text>';
const SENTENCE = '<text class="t" fill="#3d3a32" x="60" y="154">The drain claims a task that is ready.</text>';
const KEY_OPEN = '<g id="key">';
const KEY_CLOSE = "</g>\n</svg>";
// The paragraph of figures/good.md that a page case replaces with what it breaks the rule with.
const PROSE = "Keeps figure rule 16; scripts/lint-brand.mjs fails if it fires here.";
const CAPTION = 'caption="A board is a list and a loop"';

const svg = (name, rule, find, replace) => ({ name, base: "good.svg", rule, find, replace });
const page = (name, replace) => ({ name, base: "good.md", rule: "embed", find: PROSE, replace });

export default [
  // 1. Drawing only: no title, description or styling of its own, and only page.css's classes.
  svg("svg", "svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">\n<title>A board</title>'),
  svg("svg.class", "svg", DASH_BOX, DASH_BOX.replace('class="dash"', 'class="dashed"')),
  // Strokes, dashes and fonts come from the drawing classes, at the register's values.
  svg("stroke", "stroke", '<line class="hi" fill="none"', '<line class="hi" fill="none" stroke-width="2"'),
  svg("dash", "dash", '<line class="hi" fill="none"', '<line class="hi" fill="none" stroke-dasharray="6 4"'),
  svg("font", "font", LABEL, LABEL.replace('class="lb"', 'class="lb" font-family="Space Grotesk"')),
  // 2. Colour: each element carries page.css's light value for its classes, and nothing else carries one.
  svg("colour.missing", "colour", LABEL, LABEL.replace(' fill="#57544a"', "")),
  svg("colour.wrong", "colour", LABEL, LABEL.replace('fill="#57544a"', 'fill="#000000"')),
  svg("colour.unclassed", "colour", KEY_OPEN, '<g id="key" fill="#1b1a15">'),
  svg("colour.defs", "colour", 'stroke="rgba(27, 26, 21, 0.45)"', 'stroke="#1b1a15"'),
  // 4. No stroke width by attribute.
  svg("attr", "attr", '<line class="hi" fill="none" stroke="rgba(27, 26, 21, 0.25)"', '<line class="hi" fill="none" stroke="rgba(27, 26, 21, 0.25)" stroke-width="1"'),
  // 5. Elements.
  svg("element.tspan", "element", SENTENCE, SENTENCE.replace("a task that is ready", "a <tspan>ready</tspan> task")),
  svg("element.doctype", "element", ["<svg xmlns", "</defs>"], ['<!DOCTYPE svg [ <!ENTITY s "<script>alert(1)</script>"> ]>\n<svg xmlns', "</defs>\n&s;"]),
  svg("element.nested-svg", "element", NAME, `<svg x="500">${NAME}</svg>`),
  svg("element.transform-ancestor", "element", NAME, `<g transform="rotate(90 452 56)">${NAME}</g>`),
  svg("element.transform-shape", "element", DASH_BOX, `<g transform="translate(0 0)">${DASH_BOX}</g>`),
  // 6. Defs.
  svg("defs", "defs", "</defs>", '<pattern id="dots" width="4" height="4"><line class="hatch-line" stroke="rgba(27, 26, 21, 0.45)" x1="0" y1="0" x2="0" y2="4"/></pattern>\n</defs>'),
  svg("defs.commented", "defs", ["<defs>", "</defs>"], ["<!-- <defs>", "</defs> -->"]),
  // 7. Canvas.
  svg("canvas", "canvas", 'viewBox="0 0 920 200"', 'viewBox="0 0 1000 200" width="1000"'),
  svg("canvas.height", "canvas", 'viewBox="0 0 920 200"', 'viewBox="0 0 920 200" height="200"'),
  svg("canvas.units", "canvas", NAME, NAME.replace('x="452"', 'x="2em"')),
  // 8. Text class.
  svg("text-class", "text-class", LABEL, LABEL.replace("TASKS &amp; RUNS", "The tasks")),
  // 9. Text fits.
  svg("text-fit", "text-fit", NAME, NAME.replace("board.drain", "board.drain, which claims every ready task")),
  svg("text-fit.margin", "text-fit", SENTENCE, SENTENCE.replace("ready.", "ready, runs its block, records the result on the list, and then takes the next ready task until none is left.")),
  svg("text-fit.cdata", "text-fit", NAME, NAME.replace("board.drain", "<![CDATA[board.drain(&lt; every task on the board, claimed in order of readiness &gt;)]]>")),
  svg("text-fit.dx", "text-fit", NAME, NAME.replace('y="56"', 'y="56" dx="500"')),
  svg("text-fit.px", "text-fit", NAME, NAME.replace('x="452"', 'x="900px"')),
  svg("text-fit.left-margin", "text-fit", NAME, `${NAME}\n<text class="c" fill="#1b1a15" x="100" y="118" text-anchor="end">board.drain</text>`),
  svg("text-fit.box-left-margin", "text-fit", NAME, NAME.replace('x="452"', 'x="440"')),
  svg("text-fit.end-anchor-box", "text-fit", NAME, NAME.replace('x="452" y="56"', 'x="760" y="56" text-anchor="end"')),
  svg("text-fit.inherited-anchor", "text-fit", NAME, `${NAME}\n<g text-anchor="end"><text class="c" fill="#1b1a15" x="60" y="98">board.drain, claims tasks once</text></g>`),
  // 10. Arrows.
  svg("arrow", "arrow", 'x2="330" y2="64"', 'x2="330" y2="90"'),
  // 11. Key.
  svg("key", "key", KEY_CLOSE, '</g>\n<line class="hi" fill="none" stroke="rgba(27, 26, 21, 0.25)" x1="0" y1="190" x2="920" y2="190"/>\n</svg>'),
  svg("key.two-keys", "key", NOTE, `${NOTE}\n<g id="key"></g>`),
  svg("key.no-label", "key", '\n<text class="lb" fill="#57544a" x="605" y="180">CANNOT START YET</text>', ""),
  // 12. Key marks.
  svg("key-marks", "key-marks", "LASTS ONE ACTION RUN", "RUNS IN A REQUEST"),
  svg("key-marks.unused", "key-marks", KEY_CLOSE, '<line class="ln-dash" fill="none" stroke="#1b1a15" x1="787" y1="176" x2="813" y2="176" marker-end="url(#ah)"/>\n<text class="lb" fill="#57544a" x="821" y="180">ONLY IF</text>\n</g>\n</svg>'),
  // 13. Hatching.
  svg("hatch", "hatch", '<rect fill="url(#hatch)" x="28" y="24" width="300" height="10"/>', '<rect fill="url(#hatch)" x="28" y="24" width="300" height="80"/>'),
  svg("hatch.on-dash", "hatch", DASH_BOX, `<rect fill="url(#hatch)" x="438" y="24" width="300" height="10"/>${DASH_BOX}`),
  // 14. Highlighter.
  svg("highlight", "highlight", NAME, '<rect class="hl" fill="#e8f551" x="446" y="40" width="100" height="24"/>\n<text class="c on-hl" fill="#1b1a15" x="452" y="56">board.drain</text>'),
  svg("highlight.on-hl", "highlight", NAME, NAME.replace('class="c"', 'class="c on-hl"')),
  // 15. Numbering.
  svg("numbering", "numbering", NOTE, NOTE.replace(">01<", ">02<")),
  svg("numbering.layer", "numbering", LABEL, LABEL.replace("TASKS &amp; RUNS", "01 · THE TASKS")),

  // 16. On the page.
  page("embed.image", "![A board](./good.svg)"),
  page("embed.note", "*A board. Description for the site's `Figure`: the list and the drain.*"),
  { name: "embed.caption", base: "good.md", rule: "embed", find: CAPTION, replace: 'caption="A board is a list and a loop."' },
  page("embed.description", '<Figure svg={Board} caption="A list and a loop" description={"A list and a loop."}></Figure>'),
  page("embed.component", "<Board />"),
  page("embed.component-braces", "<div>{Board}</div>"),
  page("embed.component-expr", "<div>{true && Board}</div>"),
  page("embed.component-nested", "<div>{true ? Board : {a: 1}}</div>"),
  page("embed.jsx-comment-hides", "{/* don't */}\n\n{Board}\n\nIt's set on the page with no caption or description."),
  page("embed.parse", "An expression that never closes: {Board"),
  page("embed.reference-full", "![A board][board]\n\n[board]: ./good.svg"),
  page("embed.reference-collapsed", '![Board][]\n\n[board]: <./good.svg> "A board"'),
  page("embed.reference-shortcut", "![board]\n\n[board]: ./good.svg"),
  page("embed.inline-svg-markdown", '<svg viewBox="0 0 920 200"><text x="28" y="56">A BOARD</text></svg>'),
  page("embed.inline-svg-expression", '{true && <svg viewBox="0 0 920 200" />}'),
];
