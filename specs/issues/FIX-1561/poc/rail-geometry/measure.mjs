/**
 * FIX-1561 POC · measure the rendered rail, not its styles.
 *
 * Bundles `harness.tsx` against the real `FlowNavigator` source, opens it in
 * headless Chromium, expands every row, and measures what a person sees: the
 * x of each label's first glyph per tree level, where the empty-state notes
 * start, and whether each host action shares a line with a row. It then runs
 * the goal check the spec proposes (PLAN.md → VG) and prints PASS/FAIL per
 * assertion. On today's code it is expected to FAIL; that red state is the
 * evidence.
 *
 * Run from the repository root, after `pnpm install` and a build of
 * `@flow-state-dev/react`'s dependencies:
 *
 *   node specs/issues/FIX-1561/poc/rail-geometry/measure.mjs \
 *     [--variant today|always|hover] [--icons equal] [--shot <png>] [--hover <row label>]
 *     [--long] [--width <px>] [--break]
 *
 * `today` (the default) renders the real component; `always` and `hover`
 * render the sketch in `sketch/`, which applies the proposed layout.
 * `--icons equal` applies the proposed host fix for icon sizes (see
 * harness.tsx). The host buttons are the DevTool's own, so the Tailwind they
 * use is compiled here with the DevTool's toolchain.
 * `--long --width 256` adds overlong labels and narrows the rail for G7;
 * `--break` is G7's negative control on the sketch.
 *
 * Experimental evidence retained with the spec; not production code.
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const fromUi = createRequire(join(root, "packages/ui/package.json"));
const esbuild = createRequire(fromUi.resolve("vite"))("esbuild");
const { chromium } = createRequire(join(root, "apps/kitchen-sink/package.json"))("@playwright/test");

const shotArg = process.argv.indexOf("--shot");
const shot = shotArg === -1 ? null : resolve(process.argv[shotArg + 1]);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const variant = arg("--variant", "today");
const hoverRow = arg("--hover", null);
const icons = arg("--icons", "today");
const long = process.argv.includes("--long");
const width = arg("--width", "300");
const broken = process.argv.includes("--break");

// The DevTool's classes, compiled by the DevTool's own Tailwind, so the
// Button's rules resolve exactly as they do in the tool.
const fromDevtool = createRequire(join(root, "packages/devtool/package.json"));
const postcss = createRequire(fromDevtool.resolve("@tailwindcss/postcss"))("postcss");
const tailwind = fromDevtool("@tailwindcss/postcss");
const cssIn = [
  '@import "tailwindcss";',
  `@source "${join(here, "harness.tsx")}";`,
  `@source "${join(root, "packages/devtool/src/react/components/ui/button.tsx")}";`,
].join("\n");
const css = await postcss([tailwind()]).process(cssIn, {
  from: join(root, "packages/devtool/src/react/fix-1561-poc.css"),
});

const out = mkdtempSync(join(tmpdir(), "fix-1561-"));
await esbuild.build({
  entryPoints: [join(here, "harness.tsx")],
  bundle: true,
  format: "iife",
  outfile: join(out, "harness.js"),
  nodePaths: [join(root, "packages/react/node_modules"), join(root, "packages/devtool/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
writeFileSync(join(out, "harness.css"), css.css);
writeFileSync(
  join(out, "index.html"),
  '<!doctype html><html><head><link rel="stylesheet" href="harness.css"></head><body style="margin:0;background:#0f172a"><div id="root"></div><script src="harness.js"></script></body></html>',
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 300, height: 860 }, deviceScaleFactor: 2 });
await page.goto(
  `file://${join(out, "index.html")}?variant=${variant}&icons=${icons}&long=${long ? 1 : 0}&width=${width}&break=${broken ? 1 : 0}`,
);
await page.waitForSelector("[data-kind]");

// Expand everything: a collapsed rail proves nothing about nesting.
for (let pass = 0; pass < 30; pass++) {
  const closed = page.locator('button[aria-expanded="false"]');
  if ((await closed.count()) === 0) break;
  await closed.first().click();
  await page.waitForTimeout(50);
}
await page.waitForTimeout(200);

const m = await page.evaluate(() => {
  const textLeft = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length === 0) continue;
      if (node.parentElement.closest('[aria-hidden="true"]')) continue; // the twisty
      const r = document.createRange();
      r.selectNodeContents(node);
      return r.getBoundingClientRect().left;
    }
    return null;
  };
  // Tree level: kind = 1, a collection's instance = 2, a session = its leaf's level + 1.
  const rows = [];
  for (const b of document.querySelectorAll("nav button[data-kind], nav button[data-instance-id], nav button[data-session-id]")) {
    let level;
    if (b.dataset.kind) level = 1;
    else if (b.dataset.instanceId) level = 2;
    else {
      const leaf = b.closest("ul[data-leaf]");
      const singleton = leaf.parentElement.querySelector(":scope > div > button[data-kind]");
      level = singleton ? 2 : 3;
    }
    const r = b.getBoundingClientRect();
    rows.push({
      label: b.textContent.replace(/[▾▸]/g, "").trim(),
      type: b.dataset.kind ? "kind" : b.dataset.instanceId ? "instance" : "session",
      level,
      labelX: textLeft(b),
      top: r.top,
      bottom: r.bottom,
    });
  }
  const notes = [...document.querySelectorAll("nav ul[data-leaf] p")].map((p) => {
    const leaf = p.closest("ul[data-leaf]");
    const singleton = leaf.parentElement.querySelector(":scope > div > button[data-kind]");
    return { text: p.textContent.trim(), describesLevel: singleton ? 2 : 3, x: textLeft(p) };
  });
  const actions = [...document.querySelectorAll("[data-host-action]")].map((a) => {
    const r = a.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    const onRow = rows.some((row) => mid >= row.top && mid <= row.bottom);
    return { action: a.dataset.hostAction, onRow };
  });
  // A line the rail spends on host actions alone.
  const actionLines = [...document.querySelectorAll('nav ul[data-leaf] > li[role="none"]')].filter(
    (li) => li.querySelector("[data-host-action]") !== null,
  ).length;
  // G5: each row action's icon box, its button (the hit area), and, for
  // information, the ink its drawing actually covers.
  const iconBoxes = [...document.querySelectorAll("[data-host-action]")].map((a) => {
    const svg = a.querySelector("svg");
    const box = svg.getBoundingClientRect();
    const hit = a.getBoundingClientRect();
    const ink = svg.getBBox();
    const unit = box.width / svg.viewBox.baseVal.width;
    return {
      action: a.dataset.hostAction,
      w: box.width,
      h: box.height,
      hitW: hit.width,
      hitH: hit.height,
      inkW: ink.width * unit,
      inkH: ink.height * unit,
    };
  });
  // G6: every open parent that shows anything under it has one guide line,
  // on its twisty's centre, covering its first child line to its last.
  const guides = [...document.querySelectorAll('nav button[aria-expanded="true"]')].map((b) => {
    const li = b.closest("li");
    const list = li.querySelector(":scope > ul");
    const twisty = b.querySelector('[aria-hidden="true"]').getBoundingClientRect();
    const guide = list?.querySelector(":scope > [data-nav-guide]") ?? null;
    const lines = list === null ? [] : [...list.children].filter((c) => !c.hasAttribute("data-nav-guide"));
    const first = lines[0]?.getBoundingClientRect();
    const lastLine = lines.at(-1)?.firstElementChild?.getBoundingClientRect();
    const g = guide?.getBoundingClientRect();
    return {
      parent: b.textContent.replace(/[▾▸]/g, "").trim(),
      twistyX: twisty.left + twisty.width / 2,
      guideX: g ? g.left + g.width / 2 : null,
      guideTop: g?.top ?? null,
      guideBottom: g?.bottom ?? null,
      firstTop: first?.top ?? null,
      lastBottom: lastLine?.bottom ?? null,
      listBottom: list?.getBoundingClientRect().bottom ?? null,
      ariaHidden: guide?.getAttribute("aria-hidden") === "true",
    };
  });
  // G7: at the rail's width, an overlong label ellipsizes, and no row's
  // content runs past the row or the rail.
  const nav = document.querySelector("nav");
  const navRect = nav.getBoundingClientRect();
  const fit = [...document.querySelectorAll("nav button[data-kind], nav button[data-instance-id], nav button[data-session-id]")].map((b) => {
    const frame = b.parentElement;
    const frameRect = frame.getBoundingClientRect();
    const label = [...b.children].filter((c) => c.getAttribute("aria-hidden") !== "true").at(-1);
    const trailing = b.nextElementSibling;
    return {
      label: b.textContent.replace(/[▾▸]/g, "").trim(),
      long: /escalations-overnight|Refund escalation/.test(b.textContent),
      ellipsized: label.scrollWidth > label.clientWidth + 1 && getComputedStyle(label).textOverflow === "ellipsis",
      overflows:
        frame.scrollWidth > frame.clientWidth + 1 ||
        frameRect.right > navRect.right + 0.5 ||
        (trailing !== null && trailing.getBoundingClientRect().right > frameRect.right + 0.5) ||
        b.getBoundingClientRect().right > (trailing?.getBoundingClientRect().left ?? frameRect.right) + 0.5,
    };
  });
  const railOverflows = nav.scrollWidth > nav.clientWidth + 1;
  return { rows, notes, actions, actionLines, iconBoxes, guides, fit, railOverflows };
});

if (hoverRow !== null) await page.getByRole("button", { name: hoverRow, exact: true }).hover();
await page.waitForTimeout(100);
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();

// ── report ──────────────────────────────────────────────────────────────────
console.log(`variant: ${variant} · icons: ${icons} · width: ${width}${long ? " · long labels" : ""}${broken ? " · BROKEN (negative control)" : ""}\n`);
console.log("level  type      labelX  label");
for (const r of m.rows) console.log(`${r.level}      ${r.type.padEnd(8)}  ${r.labelX?.toFixed(1).padStart(6)}  ${r.label}`);
console.log("\nnotes:", m.notes.map((n) => `${n.text} @ ${n.x?.toFixed(1)} (describes level ${n.describesLevel})`).join("; "));
const own = m.actions.filter((a) => !a.onRow);
console.log(`actions: ${m.actions.length} total, ${own.length} on a line of their own`);
console.log(`lines: ${m.rows.length + m.notes.length + m.actionLines} (${m.rows.length} rows, ${m.notes.length} notes, ${m.actionLines} action-only)`);

// ── the goal check (PLAN.md → VG) ───────────────────────────────────────────
const byLevel = new Map();
for (const r of m.rows) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r.labelX]);
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const levelX = [...byLevel.entries()].sort(([a], [b]) => a - b).map(([level, xs]) => ({ level, x: xs[0], spread: spread(xs) }));
const steps = levelX.slice(1).map((l, i) => l.x - levelX[i].x);

const sizes = (key) => m.iconBoxes.map((i) => i[key]);
const range = (xs) => (xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs));
const iconLines = m.iconBoxes.map(
  (i) => `${i.action} ${i.w.toFixed(1)}×${i.h.toFixed(1)} (ink ${i.inkW.toFixed(1)}×${i.inkH.toFixed(1)}, hit ${i.hitW.toFixed(0)}×${i.hitH.toFixed(0)})`,
);
console.log(`icons: ${[...new Set(iconLines)].join("; ")}`);
const badGuides = m.guides.filter(
  (g) =>
    g.guideX === null ||
    !g.ariaHidden ||
    Math.abs(g.guideX - g.twistyX) > 0.5 ||
    g.guideTop > g.firstTop + 0.5 ||
    g.guideBottom < g.lastBottom - 0.5 ||
    g.guideBottom > g.listBottom + 0.5,
);
console.log(
  `guides: ${m.guides
    .map((g) =>
      g.guideX === null
        ? `${g.parent} none`
        : `${g.parent} x ${g.guideX.toFixed(1)} vs twisty ${g.twistyX.toFixed(1)}, ${g.guideTop.toFixed(0)}–${g.guideBottom.toFixed(0)} over ${g.firstTop.toFixed(0)}–${g.lastBottom.toFixed(0)}`,
    )
    .join("; ")}`,
);

const results = [
  ["G1 no host action sits on a line of its own", own.length === 0, `${own.length} of ${m.actions.length} off-row`],
  ["G2 every label at one level starts at one x", levelX.every((l) => l.spread <= 0.5), levelX.map((l) => `L${l.level} spread ${l.spread.toFixed(1)}px`).join(", ")],
  ["G3 each level steps right by the same amount, at least 12px", steps.every((s) => s >= 12 && Math.abs(s - steps[0]) <= 0.5), `steps ${steps.map((s) => s.toFixed(1)).join(", ")}px`],
  [
    "G4 an empty/loading note starts at the label x of the level it describes",
    m.notes.every((n) => Math.abs(n.x - (levelX.find((l) => l.level === n.describesLevel)?.x ?? NaN)) <= 0.5),
    m.notes.map((n) => `${n.text} ${n.x?.toFixed(1)} vs L${n.describesLevel}`).join("; "),
  ],
  [
    // The drawing, not the box: every box is already 16px today, and the owner
    // still saw copy drawn bigger. A box check would pass on the defect.
    "G5 every row action's drawn glyph, and its hit area, is one size (±0.5px)",
    [sizes("inkW"), sizes("inkH"), sizes("hitW"), sizes("hitH")].every((xs) => range(xs) <= 0.5),
    `glyph spread ${range(sizes("inkW")).toFixed(1)}×${range(sizes("inkH")).toFixed(1)}px; hit spread ${range(sizes("hitW")).toFixed(1)}×${range(sizes("hitH")).toFixed(1)}px; icon box spread ${range(sizes("w")).toFixed(1)}px (information)`,
  ],
  [
    "G6 each open parent has one decorative guide on its twisty centre, spanning first to last child line",
    badGuides.length === 0,
    `${m.guides.length - badGuides.length} of ${m.guides.length} parents`,
  ],
];
if (long) {
  const longRows = m.fit.filter((f) => f.long);
  const overflowing = m.fit.filter((f) => f.overflows);
  const hitOk = m.iconBoxes.every((i) => Math.abs(i.hitW - m.iconBoxes[0].hitW) <= 0.5 && Math.abs(i.hitH - m.iconBoxes[0].hitH) <= 0.5);
  results.push([
    `G7 at ${width}px an overlong label ellipsizes, actions keep their box, nothing overflows`,
    longRows.length > 0 && longRows.every((f) => f.ellipsized) && overflowing.length === 0 && !m.railOverflows && hitOk,
    `${longRows.filter((f) => f.ellipsized).length} of ${longRows.length} long labels ellipsized; ${overflowing.length} rows overflow${overflowing.length ? ` (${overflowing.map((f) => f.label).join(", ")})` : ""}; rail overflows: ${m.railOverflows}; hit boxes equal: ${hitOk}`,
  ]);
}
console.log("");
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
