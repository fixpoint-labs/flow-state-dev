#!/usr/bin/env node
// Evidence for specs/issues/FIX-2448: the export check's census, run once on
// today's tree. Throwaway spec evidence, not production code; the shipped check
// is the implementer's, built on scripts/mechanism-exports.mjs.
//
// For every published package's ROOT entry (".") it lists each export and
// classifies it by who imports it from that root:
//   app      a file under apps/ (not apps/docs or apps/devtool), examples/ or labs/: adopter-shaped code.
//            goals/, plugins/, scripts/ and packages/ are ours and do not count as an outside consumer
//   docs     a code block in apps/docs, or the package's own README naming it
//   sibling  another package under packages/ (a framework seam if nothing else uses it)
//   none     no importer outside the package and no README entry
// Retained history (specs/, docs/internal/, CHANGELOG.md, .changeset/) is skipped.
//
//   reached  a type-only export that an app- or docs-covered export's declaration names,
//            followed to a fixpoint (the adopter meets it through a signature)
// TOTALITY: every root export lands in exactly one class (the highest it earns:
// app > docs > reached > sibling > none), and the per-package sum must equal the export
// count, or the run fails.
//
// It also lists every import of an `/internal` subpath from adopter-shaped code.
//
//   node specs/issues/FIX-2448/poc/export-census/census.mjs                # summary per package
//   node specs/issues/FIX-2448/poc/export-census/census.mjs core           # core's names by class
//   node specs/issues/FIX-2448/poc/export-census/census.mjs core --files   # file · class · name, one per line
//   node specs/issues/FIX-2448/poc/export-census/census.mjs --split [--names] # the spec's split of core's root
//   node specs/issues/FIX-2448/poc/export-census/census.mjs --control      # planted violations must be caught
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fsReader, packageExports } from "../../../../../scripts/mechanism-exports.mjs";
import ts from "typescript";

const ROOT = new URL("../../../../../", import.meta.url).pathname;
const args = process.argv.slice(2);
const CONTROL = args.includes("--control");
const only = args.find((a) => !a.startsWith("--"));

// One-entry view: hand packageExports a reader whose package.json keeps only `key`.
const base = fsReader(ROOT);
const entryOnly = (key) => {
  const r = (path) => {
    const text = base(path);
    if (text == null || !/^packages\/[^/]+\/package\.json$/.test(path)) return text;
    const pkg = JSON.parse(text);
    const map = typeof pkg.exports === "string" ? { ".": pkg.exports } : pkg.exports ?? {};
    return JSON.stringify({ ...pkg, exports: map[key] ? { [key]: map[key] } : {} });
  };
  r.packageDirs = base.packageDirs;
  r.list = base.list;
  return packageExports(r);
};
const roots = entryOnly(".");

const pkgs = new Map(); // name → { dir, private }
for (const dir of base.packageDirs()) {
  const text = base(`packages/${dir}/package.json`);
  if (!text) continue;
  const p = JSON.parse(text);
  pkgs.set(p.name, { dir, private: !!p.private });
}

const HISTORY = /^(specs\/|docs\/internal\/|\.changeset\/)|CHANGELOG\.md$|^specs?-?poc|^spec\//;
const APP = /^(apps\/(?!docs\/|devtool\/)|examples\/|labs\/)/;
const CODE = /\.(m?[jt]sx?)$/;
const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\n").filter((f) => f && !HISTORY.test(f) && (CODE.test(f) || /\.mdx?$/.test(f)));

// Import statements, in code and in docs code fences. Captures the module and the brace list.
const IMPORT_RE = /(?:import|export)\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+)?\s*from\s*["'](@[\w-]+\/[\w-]+)(\/[^"']*)?["']/g;
const names = (list) => (list ?? "").split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);

const uses = new Map(); // pkg → name → Set(class)
const internalImports = [];
const note = (pkg, name, cls) => {
  if (!uses.has(pkg)) uses.set(pkg, new Map());
  const m = uses.get(pkg);
  if (!m.has(name)) m.set(name, new Set());
  m.get(name).add(cls);
};
const DYNAMIC_RE = /(?:import|require)\s*\(\s*["'](@[\w-]+\/[\w-]+)(\/[^"']*)["']/g;
function scan(file, text) {
  if (APP.test(file) || file.startsWith("apps/docs/")) for (const [, pkg, sub] of text.matchAll(DYNAMIC_RE))
    if (pkgs.has(pkg) && /(^|\/)internal(\/|$)/.test(sub)) internalImports.push(`${file} → ${pkg}${sub} (dynamic)`);
  const ownDir = file.startsWith("packages/") ? file.split("/")[1] : null;
  for (const m of text.matchAll(IMPORT_RE)) {
    const [, , , list, pkg, sub] = m;
    if (!pkgs.has(pkg)) continue;
    if (sub && /(^|\/)internal(\/|$)/.test(sub) && (APP.test(file) || file.startsWith("apps/docs/"))) internalImports.push(`${file} → ${pkg}${sub}`);
    if (sub) continue; // root only
    if (ownDir === pkgs.get(pkg).dir) continue; // the package itself
    const cls = APP.test(file) ? "app" : file.startsWith("apps/docs/") ? "docs" : file.startsWith("packages/") ? "sibling" : null;
    if (!cls) continue; // root scripts, top-level docs/: neither app nor framework package
    for (const n of names(list)) note(pkg, n, cls);
  }
}
for (const f of files) {
  let text;
  try { text = readFileSync(ROOT + f, "utf8"); } catch { continue; }
  scan(f, text);
}

// One-hop-transitive signature reach: the type names a declaration mentions.
const declCache = new Map();
function mentions(file, name) {
  const key = file + "#" + name;
  if (declCache.has(key)) return declCache.get(key);
  const out = new Set();
  declCache.set(key, out);
  const text = base(file);
  if (text == null) return out;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const declName = (st) => ts.isVariableStatement(st) ? st.declarationList.declarations.map((d) => d.name.getText?.(sf) ?? "") : [st.name?.text];
  for (const st of sf.statements) {
    if (!declName(st).includes(name)) continue;
    const walk = (n) => { if (ts.isTypeReferenceNode(n) || ts.isExpressionWithTypeArguments(n) || ts.isTypeQueryNode(n)) { const id = (n.typeName ?? n.expression ?? n.exprName); if (id) out.add(id.getText(sf).split(".")[0]); } ts.forEachChild(n, walk); };
    walk(st);
  }
  return out;
}
const readme = (pkg) => base(`packages/${pkgs.get(pkg).dir}/README.md`) ?? "";
function classify(pkg) {
  const exp = roots.get(pkg) ?? new Map();
  const doc = readme(pkg);
  const out = { app: [], docs: [], reached: [], sibling: [], none: [] };
  const first = new Map();
  for (const name of exp.keys()) {
    const u = uses.get(pkg)?.get(name) ?? new Set();
    const inReadme = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(doc);
    first.set(name, u.has("app") ? "app" : u.has("docs") || inReadme ? "docs" : u.has("sibling") ? "sibling" : "none");
  }
  // A TYPE-only export a covered (app/docs) export's declaration names is covered as "reached", to a fixpoint.
  const covered = new Set([...first].filter(([, c]) => c === "app" || c === "docs").map(([n]) => n));
  const reached = new Set();
  const queue = [...covered];
  while (queue.length) {
    const n = queue.pop();
    for (const m of mentions(exp.get(n).file, n)) {
      if (exp.has(m) && exp.get(m).type && !covered.has(m) && !reached.has(m)) { reached.add(m); queue.push(m); }
    }
  }
  for (const [name, c] of first) out[(c === "sibling" || c === "none") && reached.has(name) ? "reached" : c].push(name);
  const sum = Object.values(out).reduce((a, l) => a + l.length, 0);
  if (sum !== exp.size) throw new Error(`totality: ${pkg} classified ${sum} of ${exp.size}`);
  return out;
}

if (CONTROL) {
  // Plant: an app file importing a never-used core name and an /internal path,
  // and a sibling-only import. Each must move its name's class or be reported.
  const before = classify("@flow-state-dev/core");
  const victim = before.none[0] ?? before.sibling[0];
  const sib = before.none[1];
  scan("apps/kitchen-sink/__plant__.ts", `import { ${victim} } from "@flow-state-dev/core";\nimport type { x } from "@flow-state-dev/client/internal";\nconst y = await import("@flow-state-dev/core/items/internal");`);
  scan("packages/engine/src/__plant__.ts", `import { ${sib} } from "@flow-state-dev/core";`);
  const after = classify("@flow-state-dev/core");
  const ok = after.app.includes(victim) && after.sibling.includes(sib) && internalImports.filter((l) => l.includes("__plant__")).length === 2;
  console.log(ok ? `CONTROL PASS · planted app use of ${victim}, sibling use of ${sib}, an /internal import type and an /internal import() were all seen` : "CONTROL FAIL");
  process.exit(ok ? 0 : 1);
}

// The spec's split of core's root, by declaring file (and a few names). Every root
// name lands in exactly one destination; "check" is what the export check decides
// per name at implementation (a README line, core/internal, or deletion).
const HARNESS_FILES = ["types/harness-plan.ts", "types/pull-requests.ts", "types/harness.ts", "helpers/pull-request-recorder.ts",
  "helpers/harness-steering.ts", "helpers/harness-env.ts", "helpers/harness-activity.ts", "helpers/run-duration.ts"];
const INTERNAL_FILES = ["types/request-host.ts", "types/request-end.ts", "types/request-resume.ts", "types/board-notice.ts",
  "types/wait-gate.ts", "blocks/wait-on-request.ts", "execution/request-side-chain-pool.ts", "helpers/cache-tokens.ts",
  "blocks/internal/replay-log.ts", "blocks/internal/resolve-active-status-message.ts"];
const INTERNAL_NAMES = ["resolveAllowedActions", "isFiveFieldCron", "DISPATCH_SEAM", "DispatchSeam", "dispatchThroughSeam", "NoDispatchSeamError"];
// Called inside core, imported by nobody outside it: they stop being exported.
const UNEXPORT_NAMES = ["planConversationPrefix", "findOpenedPullRequests"];
// A value a public signature names through `typeof` (dispatcher({ wait: true })'s output): the
// census's type-only reach misses it, so it is held on the root by name.
const STAY_NAMES = ["dispatchWaitResultSchema", "DispatchWaitResult"];
const SIBLING_FILES = { "benchmark/types.ts": "testing/benchmark (its own issue)" };
function split() {
  const pkg = "@flow-state-dev/core";
  const exp = roots.get(pkg);
  const cls = new Map(Object.entries(classify(pkg)).flatMap(([k, l]) => l.map((n) => [n, k])));
  const dir = "packages/core/src/";
  const out = { unexport: [], harness: [], internal: [], sibling: [], check: [], stays: [] };
  for (const [n, e] of exp) {
    const f = e.file.replace(dir, "");
    const dest = UNEXPORT_NAMES.includes(n) ? "unexport" : STAY_NAMES.includes(n) ? "stays" : HARNESS_FILES.includes(f) ? "harness"
      : INTERNAL_FILES.includes(f) || INTERNAL_NAMES.includes(n) ? "internal" : SIBLING_FILES[f] ? "sibling"
      : ["sibling", "none"].includes(cls.get(n)) ? "check" : "stays";
    out[dest].push(n);
  }
  const sum = Object.values(out).reduce((a, l) => a + l.length, 0);
  if (sum !== exp.size) throw new Error(`totality: split ${sum} of ${exp.size}`);
  for (const n of [...UNEXPORT_NAMES, ...STAY_NAMES, ...INTERNAL_NAMES]) if (!exp.has(n)) throw new Error(`stale name in split: ${n}`);
  console.log(`core root today: ${exp.size}`);
  // The same files on the ./types subpath: a moved name leaves every public core entry.
  const types = entryOnly("./types").get(pkg);
  const onTypes = (files) => [...types].filter(([n, e]) => files.includes(e.file.replace(dir, "")) || INTERNAL_NAMES.includes(n));
  const th = onTypes(HARNESS_FILES), ti = onTypes(INTERNAL_FILES);
  console.log(`./types today: ${types.size} · from the harness files ${th.length} (${th.filter(([n]) => !exp.has(n)).length} not on the root) · from the internal files ${ti.length} (${ti.filter(([n]) => !exp.has(n)).length} not on the root)`);
  for (const [k, l] of Object.entries(out)) console.log(`${k.padEnd(9)} ${String(l.length).padStart(4)}  ${args.includes("--names") ? l.sort().join(" ") : ""}`);
}
if (args.includes("--split")) { split(); process.exit(0); }

const published = [...pkgs].filter(([, p]) => !p.private).map(([n]) => n).sort();
if (only) {
  const pkg = only.startsWith("@") ? only : `@flow-state-dev/${only}`;
  const c = classify(pkg);
  if (args.includes("--files")) {
    const exp = roots.get(pkg);
    const dir = `packages/${pkgs.get(pkg).dir}/src/`;
    const rows = Object.entries(c).flatMap(([k, l]) => l.map((n) => [exp.get(n).file.replace(dir, ""), k, n]));
    for (const r of rows.sort((a, b) => a.join(" ").localeCompare(b.join(" ")))) console.log(r.join("\t"));
  } else for (const [k, l] of Object.entries(c)) console.log(`\n## ${k} (${l.length})\n${l.sort().join(" ")}`);
} else {
  const K = ["app", "docs", "reached", "sibling", "none"];
  console.log("package".padEnd(34), "root", " app", "docs", "rchd", " sib", "none");
  let tot = { root: 0, app: 0, docs: 0, reached: 0, sibling: 0, none: 0 };
  for (const pkg of published) {
    const c = classify(pkg);
    const n = (roots.get(pkg) ?? new Map()).size;
    tot.root += n; for (const k of K) tot[k] += c[k].length;
    console.log(pkg.padEnd(34), String(n).padStart(4), ...K.map((k) => String(c[k].length).padStart(4)));
  }
  console.log("TOTAL".padEnd(34), ...["root", ...K].map((k) => String(tot[k]).padStart(4)));
  console.log(`\n/internal imports from adopter-shaped code: ${internalImports.length}`);
  for (const l of internalImports) console.log("  " + l);
}
