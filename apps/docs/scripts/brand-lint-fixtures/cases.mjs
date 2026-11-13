/**
 * The figure lint's fixtures, as edits to its clean ones: each case takes `figures/<base>`, replaces each `find` with
 * its `replace` (a string, or two arrays of the same length for several edits), and must then produce a finding of
 * `rule` whose message contains `expect`, naming the branch of the rule it breaks; or, with `rule` and `expect`
 * null, still pass every rule. `scripts/lint-brand.mjs` applies them in memory as `figures/<name>.<svg|md>`
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

const KEY_HL = '<rect class="hl" fill="#e8f551" x="571" y="170" width="26" height="11"/>';
const KEY_LAST_LABEL = `<text class="lb" ${TEXT_LB} x="605" y="180">CANNOT START YET</text>`;
const PLATE = 'text-anchor="middle">01</text>';

const svg = (name, rule, expect, find, replace) => ({ name, base: "good.svg", rule, expect, find, replace });
const page = (name, expect, replace) => ({ name, base: "good.md", rule: "embed", expect, find: PROSE, replace });

export default [
  // Must pass: the fallbacks in XML's other attribute quoting.
  svg("good.single-quotes", null, null, LABEL, LABEL.replace('fill="#57544a"', "fill='#57544a'").replace('font-size="10px"', "font-size='10px'")),
  // Must pass: an arrow drawn as a path of M, H and V, on the canvas.
  svg("good.path-arrow", null, null, '<line class="ln" fill="none" stroke="#1b1a15" stroke-width="1.3" x1="438" y1="64" x2="330" y2="64" marker-end="url(#ah)"/>', '<path class="ln" fill="none" stroke="#1b1a15" stroke-width="1.3" d="M 438 64 H 400 V 64 H 330" marker-end="url(#ah)"/>'),

  // 1. Drawing only: no title, description or styling of its own, and only page.css's classes.
  svg("svg", "svg", "<title>: the page and <Figure> own it", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 200">\n<title>A board</title>'),
  svg("svg.class", "svg", 'class "dashed" is not a drawing class', DASH_BOX, DASH_BOX.replace('class="dash"', 'class="dashed"')),
  // Strokes, dashes and fonts at the register's values.
  svg("stroke", "stroke", "stroke-width 2 (1, 1.3 or 1.4 only)", LINE_HI, LINE_HI.replace('stroke-width="1"', 'stroke-width="2"')),
  svg("dash", "dash", "stroke-dasharray 6 4 (5 4 only)", LINE_HI, `${LINE_HI} stroke-dasharray="6 4"`),
  svg("font", "font", "text set in Space Grotesk", LABEL, LABEL.replace(MONO, 'font-family="Space Grotesk"')),

  // 2. Colour: each element carries page.css's light value for its classes, and nothing else carries one.
  svg("colour.missing", "colour", '<text class="lb"> has no fill="#57544a"', LABEL, LABEL.replace(' fill="#57544a"', "")),
  svg("colour.wrong", "colour", 'fill="#000000" on <text class="lb"> is not "#57544a"', LABEL, LABEL.replace('fill="#57544a"', 'fill="#000000"')),
  svg("colour.unclassed", "colour", "on <g>: its classes set no fill", KEY_OPEN, '<g id="key" fill="#1b1a15">'),
  svg("colour.defs", "colour", 'on <line class="hatch-line"> is not', 'stroke="rgba(27, 26, 21, 0.45)"', 'stroke="#1b1a15"'),
  // 2 and 4. Fallback: the line and type values page.css gives, the same way.
  svg("fallback.dash-missing", "fallback", '<rect class="dash"> has no stroke-dasharray="5 4"', DASH_BOX, DASH_BOX.replace(' stroke-dasharray="5 4"', "")),
  svg("fallback.font-wrong", "fallback", 'font-size="12px" on <text class="lb"> is not "10px"', LABEL, LABEL.replace('font-size="10px"', 'font-size="12px"')),
  svg("fallback.unclassed", "fallback", "on <g>: its classes set no font-size", KEY_OPEN, '<g id="key" font-size="10px">'),

  // 4 and 5. Only the attributes a figure is drawn with.
  svg("attr.writing-mode", "attr", "a writing-mode attribute on <text>", NAME, NAME.replace('x="452"', 'writing-mode="tb" x="452"')),
  svg("attr.dominant-baseline", "attr", "a dominant-baseline attribute on <text>", NAME, NAME.replace('x="452"', 'dominant-baseline="hanging" x="452"')),
  svg("attr.word-spacing", "attr", "a word-spacing attribute on <text>", NAME, NAME.replace('x="452"', 'word-spacing="500" x="452"')),
  svg("attr.root", "attr", "a data-scale attribute on the root <svg>", 'viewBox="0 0 920 200"', 'viewBox="0 0 920 200" data-scale="2"'),

  // 5. Elements.
  svg("element.banned", "element", "<tspan> has no place in a drawing", SENTENCE, SENTENCE.replace("a task that is ready", "a <tspan>ready</tspan> task")),
  svg("element.opacity", "element", "a opacity attribute has no place in a drawing", NAME, NAME.replace('x="452"', 'opacity="0.5" x="452"')),
  svg("element.doctype", "element", "<!DOCTYPE> has no place in a drawing", ["<svg xmlns", "</defs>"], ['<!DOCTYPE svg [ <!ENTITY s "<script>alert(1)</script>"> ]>\n<svg xmlns', "</defs>\n&s;"]),
  svg("element.nested-svg", "element", "a nested <svg>", NAME, `<svg x="500">${NAME}</svg>`),
  svg("element.transform-ancestor", "element", "a transform on text or a group around it", NAME, `<g transform="rotate(90 452 56)">${NAME}</g>`),
  svg("element.transform-shape", "element", "a transform on <g>: a figure is drawn in canvas coordinates", DASH_BOX, `<g transform="translate(0 0)">${DASH_BOX}</g>`),
  svg("element.use", "element", "<use> is not one of the elements a figure is drawn with", NAME, `${NAME.replace('<text class="c"', '<text id="drain" class="c"')}\n<use href="#drain" x="500"/>`),
  svg("element.switch", "element", "<switch> is not one of the elements a figure is drawn with", NAME, `<switch>${NAME}</switch>`),
  svg("element.href", "element", "an href on <rect>", DASH_BOX, DASH_BOX.replace('x="438"', 'href="#hatch" x="438"')),
  svg("element.marker-outside-defs", "element", "a <marker> outside the <defs>", NAME, `${NAME}\n<marker id="ah2" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"/>`),
  svg("element.viewbox", "element", "a viewBox on <g>", NAME, `<g viewBox="0 0 10 10">${NAME}</g>`),

  // 6. Defs.
  svg("defs", "defs", "<defs> is not exactly the hatch pattern and the ah marker", "</defs>", '<pattern id="dots" width="4" height="4"><line class="hatch-line" stroke="rgba(27, 26, 21, 0.45)" stroke-width="1" x1="0" y1="0" x2="0" y2="4"/></pattern>\n</defs>'),
  svg("defs.commented", "defs", "<defs> is not exactly the hatch pattern and the ah marker", ["<defs>", "</defs>"], ["<!-- <defs>", "</defs> -->"]),

  // 7. Canvas.
  svg("canvas", "canvas", 'viewBox "0 0 1000 200" is not 0 0 920 H', 'viewBox="0 0 920 200"', 'viewBox="0 0 1000 200"'),
  svg("canvas.height", "canvas", "the root has a height", 'viewBox="0 0 920 200"', 'viewBox="0 0 920 200" height="200"'),
  svg("canvas.units", "canvas", 'x="2em" is not a number in canvas units', NAME, NAME.replace('x="452"', 'x="2em"')),
  svg("canvas.rect-past-920", "canvas", "a <rect> reaching (938, 104), off the 920 × 200 canvas", DASH_BOX, DASH_BOX.replace('width="300"', 'width="500"')),
  svg("canvas.line-past-bottom", "canvas", "a <line> reaching (460, 260), off the 920 × 200 canvas", 'x1="0" y1="128" x2="920" y2="128"', 'x1="460" y1="128" x2="460" y2="260"'),
  svg("canvas.path-relative", "canvas", "a <path> reaching (940, 90), off the 920 × 200 canvas", NAME, `${NAME}\n<path class="ln" fill="none" stroke="#1b1a15" stroke-width="1.3" d="M 860 90 h 40 h 40" marker-end="url(#ah)"/>`),
  svg("canvas.path-arc", "canvas", 'a path command "A 4 4 0 0 1 108 110" the lint does not read', NAME, `${NAME}\n<path class="ink" fill="#1b1a15" d="M 100 110 A 4 4 0 0 1 108 110"/>`),

  // 8. Text class.
  svg("text-class", "text-class", 'lb text "The tasks" is not in capitals', LABEL, LABEL.replace("TASKS &amp; RUNS", "The tasks")),
  svg("text-class.kind", "text-class", 'text class "lb c" is not one of', LABEL, LABEL.replace('class="lb"', 'class="lb c"')),

  // 9. Text fits.
  svg("text-fit", "text-fit", "less than 12 inside its box's right edge at 738", NAME, NAME.replace("board.drain", "board.drain, which claims every ready task")),
  svg("text-fit.margin", "text-fit", "ends at x=1075.2, past 892", SENTENCE, SENTENCE.replace("ready.", "ready, runs its block, records the result on the list, and then takes the next ready task until none is left.")),
  svg("text-fit.cdata", "text-fit", "ends at x=1029.5, past 892", NAME, NAME.replace("board.drain", "<![CDATA[board.drain(&lt; every task on the board, claimed in order of readiness &gt;)]]>")),
  svg("text-fit.dx", "text-fit", "a dx attribute on <text>", NAME, NAME.replace('y="56"', 'y="56" dx="500"')),
  svg("text-fit.px", "text-fit", '"board.drain" ends at x=982.5, past 892', NAME, NAME.replace('x="452"', 'x="900px"')),
  svg("text-fit.left-margin", "text-fit", "starts at x=17.5, inside the 28 left margin", NAME, `${NAME}\n<text class="c" ${TEXT_C} x="100" y="118" text-anchor="end">board.drain</text>`),
  svg("text-fit.box-left-margin", "text-fit", "less than 12 inside its box's left edge at 438", NAME, NAME.replace('x="452"', 'x="440"')),
  svg("text-fit.end-anchor-box", "text-fit", '"board.drain" ends at x=760.0, less than 12 inside its box\'s right edge', NAME, NAME.replace('x="452" y="56"', 'x="760" y="56" text-anchor="end"')),
  svg("text-fit.inherited-anchor", "text-fit", "starts at x=-165.0, inside the 28 left margin", NAME, `${NAME}\n<g text-anchor="end"><text class="c" ${TEXT_C} x="60" y="98">board.drain, claims tasks once</text></g>`),
  svg("text-fit.anchor-unknown", "text-fit", 'text-anchor="inherit" is not start, middle or end', NAME, NAME.replace('x="452"', 'text-anchor="inherit" x="452"')),

  // 10. Arrows.
  svg("arrow", "arrow", "a <line> arrow that is not horizontal or vertical", 'x2="330" y2="64"', 'x2="330" y2="90"'),
  // Codex's case: a misspelt marker reference drew no arrowhead and still counted as an arrow.
  svg("arrow.missing-marker", "arrow", 'marker-end="url(#missing)" names no <marker>', 'marker-end="url(#ah)"', 'marker-end="url(#missing)"'),

  // 11. Key.
  svg("key", "key", "the key is not the figure's last element", KEY_CLOSE, `</g>\n<line class="hi" ${LINE_HI} x1="0" y1="190" x2="920" y2="190"/>\n</svg>`),
  svg("key.two-keys", "key", "2 key elements", NOTE, `${NOTE}\n<g id="key"></g>`),
  svg("key.no-label", "key", "a key sample with no label after it", `\n${KEY_LAST_LABEL}`, ""),
  svg("key.not-lb", "key", 'key label "AND MORE" is not one lb label after a sample', KEY_LAST_LABEL, `${KEY_LAST_LABEL}\n<text class="plate" fill="#1b1a15" ${MONO} font-size="10.5px" font-weight="500" letter-spacing="1px" x="760" y="180">AND MORE</text>`),
  svg("key.two-samples", "key", 'key entry "CANNOT START YET" has 2 samples, not one', KEY_HL, `${KEY_HL}<rect class="hl" fill="#e8f551" x="540" y="170" width="26" height="11"/>`),

  // 12. Key marks.
  svg("key-marks", "key-marks", 'the dash label "RUNS IN A REQUEST" must be exactly', "LASTS ONE ACTION RUN", "RUNS IN A REQUEST"),
  svg("key-marks.unused", "key-marks", 'key entry "ONLY IF" is for ln-dash, which the drawing does not use', KEY_CLOSE, `<line class="ln-dash" fill="none" stroke="#1b1a15" stroke-width="1.3" stroke-dasharray="5 4" x1="787" y1="176" x2="813" y2="176" marker-end="url(#ah)"/>\n<text class="lb" ${TEXT_LB} x="821" y="180">ONLY IF</text>\n</g>\n</svg>`),
  svg("key-marks.unlisted", "key-marks", "the drawing uses hl, and the key has no entry for it", `\n${KEY_HL}\n${KEY_LAST_LABEL}`, ""),
  svg("key-marks.no-mark", "key-marks", 'key entry "CANNOT START YET" shows no mark', KEY_HL, '<rect class="thin" fill="none" stroke="#1b1a15" stroke-width="1" x="571" y="170" width="26" height="11"/>'),
  svg("key-marks.sample-element", "key-marks", "the hl sample is a <line>, not a <rect>", KEY_HL, '<line class="hl" fill="#e8f551" x1="571" y1="176" x2="597" y2="176"/>'),

  // 13. Hatching.
  svg("hatch", "hatch", "hatching that is not a band 10 tall", '<rect fill="url(#hatch)" x="28" y="24" width="300" height="10"/>', '<rect fill="url(#hatch)" x="28" y="24" width="300" height="80"/>'),
  svg("hatch.on-dash", "hatch", "hatching that is not a band 10 tall", DASH_BOX, `<rect fill="url(#hatch)" x="438" y="24" width="300" height="10"/>${DASH_BOX}`),

  // 14. Highlighter.
  svg("highlight", "highlight", "2 highlighted shapes: a figure has one", NAME, `<rect class="hl" fill="#e8f551" x="446" y="40" width="100" height="24"/>\n${NAME.replace('class="c"', 'class="c on-hl"')}`),
  svg("highlight.on-hl", "highlight", 'on-hl text "board.drain" runs from', NAME, NAME.replace('class="c"', 'class="c on-hl"')),
  // Starts on the highlighter and runs past its right edge (Codex's case: only the anchor was checked).
  svg("highlight.on-hl-overflow", "highlight", 'on-hl text "compare" runs from x=150.0', 'x="42" y="84">compare', 'x="150" y="84">compare'),

  // 15. Numbering.
  svg("numbering", "numbering", 'note "02" where 01 comes next', NOTE, NOTE.replace(">01<", ">02<")),
  svg("numbering.plate", "numbering", "plate 02 has no note 02", PLATE, PLATE.replace(">01<", ">02<")),
  svg("numbering.layer", "numbering", '"01 · THE TASKS" numbers a layer', LABEL, LABEL.replace("TASKS &amp; RUNS", "01 · THE TASKS")),

  // 16. On the page.
  page("embed.image", "a figure set as an image", "![A board](./good.svg)"),
  page("embed.img", "a figure set as an image", '<img src="./good.svg" />'),
  page("embed.note", "a note about how the figure will be embedded", "*A board. Description for the site's `Figure`: the list and the drain.*"),
  { name: "embed.caption", base: "good.md", rule: "embed", expect: 'caption "A board is a list and a loop." is over 60 characters or ends in a full stop', find: CAPTION, replace: 'caption="A board is a list and a loop."' },
  { name: "embed.no-caption", base: "good.md", rule: "embed", expect: "<Figure> has no caption", find: ` ${CAPTION}`, replace: "" },
  { name: "embed.no-svg", base: "good.md", rule: "embed", expect: "<Figure> has no svg", find: "<Figure svg={Board} ", replace: "<Figure " },
  page("embed.description", "the description is 5 words", '<Figure svg={Board} caption="A list and a loop" description={"A list and a loop."}></Figure>'),
  page("embed.component", "Board is used outside a <Figure>'s svg", "<Board />"),
  page("embed.component-braces", "Board is used outside a <Figure>'s svg", "<div>{Board}</div>"),
  page("embed.component-expr", "Board is used outside a <Figure>'s svg", "<div>{true && Board}</div>"),
  page("embed.component-nested", "Board is used outside a <Figure>'s svg", "<div>{true ? Board : {a: 1}}</div>"),
  page("embed.jsx-comment-hides", "Board is used outside a <Figure>'s svg", "{/* don't */}\n\n{Board}\n\nIt's set on the page with no caption or description."),
  page("embed.parse", "the page does not parse as MDX", "An expression that never closes: {Board"),
  page("embed.reference-full", "a figure set as an image", "![A board][board]\n\n[board]: ./good.svg"),
  page("embed.reference-collapsed", "a figure set as an image", '![Board][]\n\n[board]: <./good.svg> "A board"'),
  page("embed.reference-shortcut", "a figure set as an image", "![board]\n\n[board]: ./good.svg"),
  page("embed.inline-svg-markdown", "an inline <svg> on the page", '<svg viewBox="0 0 920 200"><text x="28" y="56">A BOARD</text></svg>'),
  page("embed.inline-svg-expression", "an inline <svg> on the page", '{true && <svg viewBox="0 0 920 200" />}'),
];
