/**
 * Entry-key census: every `*_ENTRY` constant and `*Entry()` entry factory a
 * published package root exports, and who imports each from outside its package.
 *
 * Retained spec evidence, not production code. Run from the repo root:
 *   node specs/issues/FIX-2463/poc/entry-census/census.mjs [--plant]
 * `--plant` adds a fake root export to prove the census sees a name nobody listed
 * (the negative control: the totality assertion must then fail).
 * `--expect-none` is the after state: it fails while any `*_ENTRY` remains on
 * workforce's root, the one root this issue owns. Core's and orchestration's are
 * printed as their own roots' issues' to move.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fsReader, packageExports } from "../../../../../scripts/mechanism-exports.mjs";

const ROOT = process.cwd();
const plant = process.argv.includes("--plant");
const base = fsReader(ROOT);

// Root-only view: hide every subpath so packageExports reports the "." entry alone.
const rootOnly = (path) => {
  if (plant && path === "packages/workforce/src/index.ts") return base(path) + '\nexport const PLANTED_ENTRY = "planted";\n';
  const text = base(path);
  if (text == null || !/^packages\/[^/]+\/package\.json$/.test(path)) return text;
  const pkg = JSON.parse(text);
  if (pkg.exports && typeof pkg.exports === "object" && pkg.exports["."]) pkg.exports = { ".": pkg.exports["."] };
  return JSON.stringify(pkg);
};
rootOnly.packageDirs = base.packageDirs;
rootOnly.list = base.list;

const published = new Set();
for (const dir of base.packageDirs()) {
  const t = base(`packages/${dir}/package.json`);
  if (t && !JSON.parse(t).private) published.add(JSON.parse(t).name);
}

const isEntryConst = (n) => /_ENTRY$/.test(n);
const isEntryFactory = (n, file) => /^[a-z][A-Za-z]*Entry$/.test(n) && /entry|steer|admission|settled|received|lead|scheduled/i.test(file);

const index = packageExports(rootOnly);
const found = [];
for (const [pkg, names] of index) {
  if (!published.has(pkg)) continue;
  for (const [n, e] of names) {
    if (isEntryConst(n)) found.push({ pkg, name: n, kind: "const", file: e.file });
    else if (isEntryFactory(n, e.file)) found.push({ pkg, name: n, kind: "factory", file: e.file });
  }
}

// Import census: files outside the declaring package that name the export.
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "node_modules" || f.name === "dist" || f.name.startsWith(".")) continue;
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(f.name)) out.push(p);
  }
  return out;
};
const files = [...walk(join(ROOT, "packages")), ...walk(join(ROOT, "apps"))].map((f) => f.slice(ROOT.length + 1));
const text = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
for (const row of found) {
  const own = row.file.split("/").slice(0, 2).join("/");
  const re = new RegExp(`\\b${row.name}\\b`);
  const users = files.filter((f) => !f.startsWith(own + "/") && re.test(text.get(f)));
  row.outside = users.filter((f) => !/\.test\.|__tests__|\/tests?\//.test(f));
  row.outsideTests = users.filter((f) => /\.test\.|__tests__|\/tests?\//.test(f));
}

found.sort((a, b) => a.kind.localeCompare(b.kind) || a.pkg.localeCompare(b.pkg) || a.name.localeCompare(b.name));
for (const r of found) {
  console.log(`${r.kind.padEnd(8)} ${r.pkg.padEnd(32)} ${r.name.padEnd(28)} outside:${r.outside.length} tests:${r.outsideTests.length}`);
  for (const u of r.outside) console.log(`           ↳ ${u}`);
}
const consts = found.filter((r) => r.kind === "const");
const factories = found.filter((r) => r.kind === "factory");
console.log(`\nroot *_ENTRY constants: ${consts.length} · root entry factories: ${factories.length}`);

// Totality: every root-exported *_ENTRY constant is one the spec classifies.
const CLASSIFIED = new Set([
  "@flow-state-dev/core:WAIT_DEADLINE_ENTRY",
  "@flow-state-dev/workforce:WORKER_TASK_ENTRY",
  "@flow-state-dev/workforce:STEER_TURN_ENTRY",
  "@flow-state-dev/workforce:DISPATCH_ENTRY",
  "@flow-state-dev/workforce:CHECK_TASK_ENTRY",
  "@flow-state-dev/workforce:TASK_SETTLED_ENTRY",
  "@flow-state-dev/workforce:FILE_SCHEDULED_TASK_ENTRY",
  "@flow-state-dev/workforce:WORKSTREAM_OPENED_ENTRY",
  "@flow-state-dev/workforce:INTAKE_ENTRY",
  "@flow-state-dev/workforce:REPORT_ENTRY",
  "@flow-state-dev/workforce:COMMENT_ENTRY",
  "@flow-state-dev/workforce:REPORTS_ENTRY",
  "@flow-state-dev/workforce:LINE_ENTRY",
  "@flow-state-dev/workforce:MESSAGE_RECEIVED_ENTRY",
  "@flow-state-dev/orchestration:TASK_SETTLED_ENTRY",
]);
const unclassified = consts.filter((r) => !CLASSIFIED.has(`${r.pkg}:${r.name}`));
if (unclassified.length) {
  console.error(`FAIL: unclassified root *_ENTRY constants: ${unclassified.map((r) => `${r.pkg}:${r.name}`).join(", ")}`);
  process.exit(1);
}
console.log("PASS: every root *_ENTRY constant is classified in the spec");
const OWNED = "@flow-state-dev/workforce";
const elsewhere = consts.filter((r) => r.pkg !== OWNED);
if (elsewhere.length) console.log(`not this issue's (moved with their own roots): ${elsewhere.map((r) => `${r.pkg}:${r.name}`).join(", ")}`);
const owned = consts.filter((r) => r.pkg === OWNED);
if (process.argv.includes("--expect-none") && owned.length > 0) {
  console.error(`FAIL: ${owned.length} *_ENTRY constants are still on workforce's root`);
  process.exit(1);
}
