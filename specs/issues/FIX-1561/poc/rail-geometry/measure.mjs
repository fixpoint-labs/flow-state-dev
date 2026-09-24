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
 *     [--variant today|always|hover] [--shot <png>] [--hover <row label>]
 *
 * `today` (the default) renders the real component; `always` and `hover`
 * render the sketch in `sketch/`, which applies the proposed layout.
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

const out = mkdtempSync(join(tmpdir(), "fix-1561-"));
await esbuild.build({
  entryPoints: [join(here, "harness.tsx")],
  bundle: true,
  format: "iife",
  outfile: join(out, "harness.js"),
  nodePaths: [join(root, "packages/react/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
writeFileSync(
  join(out, "index.html"),
  '<!doctype html><html><body style="margin:0;background:#0f172a"><div id="root"></div><script src="harness.js"></script></body></html>',
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 300, height: 640 }, deviceScaleFactor: 2 });
await page.goto(`file://${join(out, "index.html")}?variant=${variant}`);
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
  return { rows, notes, actions, actionLines };
});

if (hoverRow !== null) await page.getByRole("button", { name: hoverRow, exact: true }).hover();
await page.waitForTimeout(100);
if (shot) await page.screenshot({ path: shot, fullPage: true });
await browser.close();

// ── report ──────────────────────────────────────────────────────────────────
console.log(`variant: ${variant}\n`);
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

const results = [
  ["G1 no host action sits on a line of its own", own.length === 0, `${own.length} of ${m.actions.length} off-row`],
  ["G2 every label at one level starts at one x", levelX.every((l) => l.spread <= 0.5), levelX.map((l) => `L${l.level} spread ${l.spread.toFixed(1)}px`).join(", ")],
  ["G3 each level steps right by the same amount, at least 12px", steps.every((s) => s >= 12 && Math.abs(s - steps[0]) <= 0.5), `steps ${steps.map((s) => s.toFixed(1)).join(", ")}px`],
  [
    "G4 an empty/loading note starts at the label x of the level it describes",
    m.notes.every((n) => Math.abs(n.x - (levelX.find((l) => l.level === n.describesLevel)?.x ?? NaN)) <= 0.5),
    m.notes.map((n) => `${n.text} ${n.x?.toFixed(1)} vs L${n.describesLevel}`).join("; "),
  ],
];
console.log("");
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
