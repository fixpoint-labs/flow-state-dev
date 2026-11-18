/**
 * Re-derives the counted facts FIX-2783's spec rests on, from the checkout it runs in.
 * Throwaway POC evidence, not production code.
 *
 *   node specs/issues/FIX-2783/poc/census/census.mjs            # the census
 *   node specs/issues/FIX-2783/poc/census/census.mjs --control  # plants one 9px size; the arbitrary count must rise by 1
 *
 * Facts: per tree, how many `text-xs` / `text-sm` / larger steps and arbitrary sizes (`text-[Npx]`)
 * the .tsx files carry; and that every registry copy in the labs and Kitchen Sink is byte-identical
 * to its source, so a registry edit reaches all of them. Totality: every .tsx file under a tree is
 * read, and the file count is printed so a shrinking scan shows. Also: how many of the four trees'
 * sizes are unique sites (the total less those in the labs' registry copies), and how many hard-coded
 * sizes Kitchen Sink's own screens carry (every .tsx under apps/kitchen-sink except its registry
 * copies in components/flow-state, which follow the registry).
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const TREES = {
  "Shift Manager": "packages/shift-manager/src",
  Teammates: "labs/teammates/src",
  "Claude Code-style": "labs/claude-code-style/src",
  "Registry components": "packages/ui/registry/components",
};
const COPIES = [
  "packages/shift-manager/src/components/flow-state",
  "labs/teammates/src/components/flow-state",
  "labs/claude-code-style/src/components/flow-state",
  "apps/kitchen-sink/components/flow-state",
];
const ARBITRARY = /(?<![\w-])text-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

function walk(dir, skip = []) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (skip.includes(name) || skip.includes(p)) return [];
    return statSync(p).isDirectory() ? walk(p, skip) : [p];
  });
}

function arbitraryIn(files) {
  const sizes = {};
  let n = 0;
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(ARBITRARY)) {
      n += 1;
      sizes[m[1] + m[2]] = (sizes[m[1] + m[2]] ?? 0) + 1;
    }
  }
  return { n, sizes };
}

function census(root) {
  const out = {};
  for (const [name, tree] of Object.entries(TREES)) {
    const files = walk(join(root, tree)).filter((f) => f.endsWith(".tsx"));
    const row = { files: files.length, xs: 0, sm: 0, larger: 0, arbitrary: 0, sizes: {} };
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      row.xs += (src.match(/\btext-xs\b/g) ?? []).length;
      row.sm += (src.match(/\btext-sm\b/g) ?? []).length;
      row.larger += (src.match(/\btext-(?:base|lg|xl|[2-9]xl)\b/g) ?? []).length;
      for (const m of src.matchAll(ARBITRARY)) {
        row.arbitrary += 1;
        const k = m[1] + m[2];
        row.sizes[k] = (row.sizes[k] ?? 0) + 1;
      }
    }
    out[name] = row;
  }
  return out;
}

function copyDrift(root) {
  const src = join(root, "packages/ui/registry/components");
  return COPIES.map((dir) => {
    const abs = join(root, dir);
    const files = walk(abs).map((f) => relative(abs, f)).filter((f) => existsSync(join(src, f)));
    const differ = files.filter((f) => !readFileSync(join(abs, f)).equals(readFileSync(join(src, f))));
    return { dir, copies: files.length, differ };
  });
}

if (process.argv.includes("--control")) {
  const before = census(ROOT)["Teammates"].arbitrary;
  const tmp = mkdtempSync(join(tmpdir(), "fix-2783-census-"));
  cpSync(join(ROOT, TREES.Teammates), join(tmp, TREES.Teammates), { recursive: true });
  for (const t of Object.values(TREES)) if (t !== TREES.Teammates) cpSync(join(ROOT, t), join(tmp, t), { recursive: true });
  writeFileSync(join(tmp, TREES.Teammates, "components/Planted.tsx"), 'export const P = () => <span className="text-[9px]">x</span>;\n');
  const after = census(tmp)["Teammates"].arbitrary;
  rmSync(tmp, { recursive: true, force: true });
  console.log(`control: Teammates arbitrary sizes ${before} -> ${after} with one planted text-[9px]`);
  process.exit(after === before + 1 ? 0 : 1);
}

const fmt = (sizes) => Object.entries(sizes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" ");
const c = census(ROOT);
for (const [name, r] of Object.entries(c)) {
  console.log(`${name}: ${r.files} files · text-xs ${r.xs} · text-sm ${r.sm} · base+ ${r.larger} · arbitrary ${r.arbitrary} (${fmt(r.sizes)})`);
}
const total = Object.values(c).reduce((n, r) => n + r.arbitrary, 0);
const below12 = Object.values(c).reduce((n, r) => n + Object.entries(r.sizes).filter(([k]) => parseFloat(k) < 12).reduce((m, [, v]) => m + v, 0), 0);
console.log(`arbitrary sizes, all four trees: ${total} (below 12px: ${below12})`);
const regSrc = join(ROOT, "packages/ui/registry/components");
const labCopyFiles = COPIES.filter((d) => !d.startsWith("apps/")).flatMap((d) =>
  walk(join(ROOT, d)).filter((f) => f.endsWith(".tsx") && existsSync(join(regSrc, relative(join(ROOT, d), f)))),
);
const inLabCopies = arbitraryIn(labCopyFiles).n;
console.log(`unique sites: ${total - inLabCopies} (the other ${inLabCopies} are in the labs' registry copies)`);
const ksRoot = join(ROOT, "apps/kitchen-sink");
const ksFiles = walk(ksRoot, ["node_modules", ".next", join(ksRoot, "components/flow-state")]).filter((f) => f.endsWith(".tsx"));
const ks = arbitraryIn(ksFiles);
const ksHit = ksFiles.filter((f) => arbitraryIn([f]).n > 0).length;
console.log(`Kitchen Sink own screens (registry copies excluded): ${ksFiles.length} files · arbitrary ${ks.n} in ${ksHit} files (${fmt(ks.sizes)})`);
for (const d of copyDrift(ROOT)) console.log(`${d.dir}: ${d.copies} registry copies, ${d.differ.length} differ${d.differ.length ? ` (${d.differ.join(", ")})` : ""}`);
