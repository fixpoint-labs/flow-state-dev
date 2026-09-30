#!/usr/bin/env node
/**
 * FIX-1655 spec evidence: re-derive the scope the spec rests on.
 *
 * 1. Every `@flow-state-dev/ui` registry component file (stories excluded) is
 *    classified as either CLEAN (colours only through semantic tokens) or
 *    PALETTE (at least one fixed Tailwind palette class or colour literal; a
 *    fully transparent literal such as `#0000` is not a colour). Totality: the two
 *    classes must add up to every walked file, so a file nobody listed cannot
 *    slip past.
 * 2. Every `@flow-state-dev/react` chrome file (navigator + panels) is scanned
 *    for colour literals outside a `var(--fsd-*, <fallback>)`.
 *
 * Retained spec evidence, not production code: nothing imports it and no
 * package's test root discovers it. PLAN S5 is its productionized form and the
 * only definition of "clean" CI runs; this file is frozen spec-time evidence.
 *
 * Run from the repo root:
 *   node specs/issues/FIX-1655/poc/palette-census/census.mjs
 * Negative control (plants one palette file in a temp copy; must report 13
 * and exit 1 against the expected 12):
 *   node specs/issues/FIX-1655/poc/palette-census/census.mjs --control
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const EXPECTED_PALETTE_FILES = 12;

const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|shadow|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:\/\d+)?\b/g;
const LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/g;
// Fully transparent hex (`#0000`, `#00000000`) carries no colour a theme could change.
const TRANSPARENT = /^#0{4}(?:0{4})?$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const control = process.argv.includes("--control");
let registryDir = "packages/ui/registry/components";
if (control) {
  const tmp = mkdtempSync(join(tmpdir(), "fix1655-census-"));
  cpSync(registryDir, tmp, { recursive: true });
  writeFileSync(join(tmp, "planted.tsx"), 'export const X = () => <span className="text-amber-500" />;\n');
  registryDir = tmp;
}

const files = walk(registryDir)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .filter((f) => !f.endsWith(".stories.tsx"));
const clean = [];
const palette = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const literals = (src.match(LITERAL) ?? []).filter((m) => !TRANSPARENT.test(m));
  const hits = [...new Set([...(src.match(PALETTE) ?? []), ...literals])];
  (hits.length ? palette : clean).push({ file: relative(registryDir, f), hits });
}

console.log(`registry files walked: ${files.length} · clean: ${clean.length} · palette: ${palette.length}`);
for (const p of palette) console.log(`  PALETTE ${p.file}: ${p.hits.join(" ")}`);

const chromeFiles = walk("packages/react/src/components/flow-navigator")
  .concat(walk("packages/react/src/components/panels"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const chromeLiterals = [];
for (const f of chromeFiles) {
  // A literal inside `var(--fsd-..., <fallback>)` is the neutral fallback the contract ships.
  const src = readFileSync(f, "utf8").replace(/var\(--fsd-[a-z0-9-]+,[^)]*\)\)?/g, "");
  for (const m of src.match(LITERAL) ?? []) chromeLiterals.push(`${f}: ${m}`);
}
console.log(`react chrome files walked: ${chromeFiles.length} · colour literals outside --fsd-* fallbacks: ${chromeLiterals.length}`);
for (const l of chromeLiterals) console.log(`  LITERAL ${l}`);

const failures = [];
if (clean.length + palette.length !== files.length) failures.push("totality: a walked file was not classified");
if (palette.length !== EXPECTED_PALETTE_FILES)
  failures.push(`expected ${EXPECTED_PALETTE_FILES} palette files, found ${palette.length}`);
if (chromeLiterals.length !== 0) failures.push("react chrome carries a colour literal outside its contract");

if (failures.length) {
  console.log(`FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("PASS — the spec's scope matches the tree");
