/**
 * The figure lint's fixtures, as edits to its clean ones: each case takes `figures/<base>`, replaces each `find` with
 * its `replace` (a string, or two arrays of the same length for several edits), and must then trip `rule`, or, with
 * `rule: null`, still pass every rule. `scripts/lint-brand.mjs` applies them in memory as `figures/<name>.<svg|md>`
 * and fails if a `find` is not in its base (an edit that no longer applies would otherwise pass for nothing) or if
 * the case does not do what its rule says.
 */

// The fallbacks figures/good.svg carries, as page.css's light theme gives them.
const MONO = "font-family=\"'IBM Plex Mono', ui-monospace, monospace\"";
const TEXT_C = `fill="#1b1a15" ${MONO} font-size="12.5px" font-weight="500"`;
const TEXT_LB = `fill="#57544a" ${MONO} font-size="10px" font-weight="500" letter-spacing="1.5px"`;
const LINE_HI = 'fill="none" stroke="rgba(27, 26, 21, 0.25)" stroke-width="1"';
const LINE_DASH = 'fill="none" stroke="#1b1a15" stroke-width="1.4" stroke-dasharray="5 4"';
// Lines of figures/good.svg that the cases edit.
const NAME = `<text class="c" ${TEXT_C} x="452" y="56">board.drain</text>`;
const LABEL = `<text class="lb" ${TEXT_LB} x="42" y="56">TASKS &amp; RUNS</text>`;
const DASH_BOX = `<rect class="dash" ${LINE_DASH} x="438" y="24" width="300" height="80"/>`;
const NOTE = `<text class="n" fill="#1b1a15" ${MONO} font-size="11px" font-weight="500" x="28" y="154">01</text>`;
const SENTENCE = `<text class="t" fill="#3d3a32" ${MONO} font-size="12px" font-weight="500" x="60" y="154">The drain claims a task that is ready.</text>`;
const KEY_OPEN = '<g id="key">';
const KEY_CLOSE = "</g>\n</svg>";
// The paragraph of figures/good.md that a page case replaces with what it breaks the rule with.
const PROSE = "Keeps figure rule 16; scripts/lint-brand.mjs fails if it fires here.";
const CAPTION = 'caption="A board is a list and a loop"';

const svg = (name, rule, find, replace) => ({ name, base: "good.svg", rule, find, replace });
const page = (name, replace) => ({ name, base: "good.md", rule: "embed", find: PROSE, replace });

export default [
  // Must pass: the fallbacks in XML's other attribute quoting.
  svg("good.single-quotes", null, LABEL, LABEL.replace('fill="#57544a"', "fill='#57544a'").replace('font-size="10px"', "font-size='10px'")),
  // 1. Drawing only: no title, description or styling of its own, and only page.css's classes.
  svg("svg", "svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">\n<title>A board</title>'),
  svg("svg.class", "svg", DASH_BOX, DASH_BOX.replace('class="dash"', 'class="dashed"')),
  // Strokes, dashes and fonts at the register's values.
  svg("stroke", "stroke", LINE_HI, LINE_HI.replace('stroke-width="1"', 'stroke-width="2"')),
  svg("dash", "dash", LINE_HI, `${LINE_HI} stroke-dasharray="6 4"`),
  svg("font", "font", LABEL, LABEL.replace(MONO, 'font-family="Space Grotesk"')),
  // 2. Colour: each element carries page.css's light value for its classes, and nothing else carries one.
  svg("colour.missing", "colour", LABEL, LABEL.replace(' fill="#57544a"', "")),
  svg("colour.wrong", "colour", LABEL, LABEL.replace('fill="#57544a"', 'fill="#000000"')),
  svg("colour.unclassed", "colour", KEY_OPEN, '<g id="key" fill="#1b1a15">'),
  svg("colour.defs", "colour", 'stroke="rgba(27, 26, 21, 0.45)"', 'stroke="#1b1a15"'),
  // 2 and 4. Fallback: the line and type values page.css gives, the same way.
  svg("fallback.dash-missing", "fallback", DASH_BOX, DASH_BOX.replace(' stroke-dasharray="5 4"', "")),
  svg("fallback.font-wrong", "fallback", LABEL, LABEL.replace('font-size="10px"', 'font-size="12px"')),
  svg("fallback.unclassed", "fallback", KEY_OPEN, '<g id="key" font-size="10px">'),
  // 5. Elements.
  svg("element.tspan", "element", SENTENCE, SENTENCE.replace("a task that is ready", "a <tspan>ready</tspan> task")),
  svg("element.doctype", "element", ["<svg xmlns", "</defs>"], ['<!DOCTYPE svg [ <!ENTITY s "<script>alert(1)</script>"> ]>\n<svg xmlns', "</defs>\n&s;"]),
  svg("element.nested-svg", "element", NAME, `<svg x="500">${NAME}</svg>`),
  svg("element.transform-ancestor", "element", NAME, `<g transform="rotate(90 452 56)">${NAME}</g>`),
  svg("element.transform-shape", "element", DASH_BOX, `<g transform="translate(0 0)">${DASH_BOX}</g>`),
  svg("element.use", "element", NAME, `${NAME.replace('<text class="c"', '<text id="drain" class="c"')}\n<use href="#drain" x="500"/>`),
  svg("element.switch", "element", NAME, `<switch>${NAME}</switch>`),
  // 6. Defs.
  svg("defs", "defs", "</defs>", '<pattern id="dots" width="4" height="4"><line class="hatch-line" stroke="rgba(27, 26, 21, 0.45)" stroke-width="1" x1="0" y1="0" x2="0" y2="4"/></pattern>\n</defs>'),
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
  svg("text-fit.left-margin", "text-fit", NAME, `${NAME}\n<text class="c" ${TEXT_C} x="100" y="118" text-anchor="end">board.drain</text>`),
  svg("text-fit.box-left-margin", "text-fit", NAME, NAME.replace('x="452"', 'x="440"')),
  svg("text-fit.end-anchor-box", "text-fit", NAME, NAME.replace('x="452" y="56"', 'x="760" y="56" text-anchor="end"')),
  svg("text-fit.inherited-anchor", "text-fit", NAME, `${NAME}\n<g text-anchor="end"><text class="c" ${TEXT_C} x="60" y="98">board.drain, claims tasks once</text></g>`),
  // 10. Arrows.
  svg("arrow", "arrow", 'x2="330" y2="64"', 'x2="330" y2="90"'),
  // 11. Key.
  svg("key", "key", KEY_CLOSE, `</g>\n<line class="hi" ${LINE_HI} x1="0" y1="190" x2="920" y2="190"/>\n</svg>`),
  svg("key.two-keys", "key", NOTE, `${NOTE}\n<g id="key"></g>`),
  svg("key.no-label", "key", `\n<text class="lb" ${TEXT_LB} x="605" y="180">CANNOT START YET</text>`, ""),
  // 12. Key marks.
  svg("key-marks", "key-marks", "LASTS ONE ACTION RUN", "RUNS IN A REQUEST"),
  svg("key-marks.unused", "key-marks", KEY_CLOSE, `<line class="ln-dash" fill="none" stroke="#1b1a15" stroke-width="1.3" stroke-dasharray="5 4" x1="787" y1="176" x2="813" y2="176" marker-end="url(#ah)"/>\n<text class="lb" ${TEXT_LB} x="821" y="180">ONLY IF</text>\n</g>\n</svg>`),
  // 13. Hatching.
  svg("hatch", "hatch", '<rect fill="url(#hatch)" x="28" y="24" width="300" height="10"/>', '<rect fill="url(#hatch)" x="28" y="24" width="300" height="80"/>'),
  svg("hatch.on-dash", "hatch", DASH_BOX, `<rect fill="url(#hatch)" x="438" y="24" width="300" height="10"/>${DASH_BOX}`),
  // 14. Highlighter.
  svg("highlight", "highlight", NAME, `<rect class="hl" fill="#e8f551" x="446" y="40" width="100" height="24"/>\n${NAME.replace('class="c"', 'class="c on-hl"')}`),
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
