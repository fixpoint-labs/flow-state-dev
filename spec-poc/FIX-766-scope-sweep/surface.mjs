#!/usr/bin/env node
/**
 * Public-surface parse: enumerate every name a publishable FSD package EXPORTS
 * (top-level exports + the members of exported object/interface/class types)
 * and flag the ones carrying the standalone token `work`.
 *
 * Rule: split each identifier on camel/Pascal boundaries, lowercase the tokens,
 * flag if any token === "work". This deliberately does NOT match `framework`,
 * `network`, `workstream`, `Workstreams` (tier-3 vocabulary that must SURVIVE
 * the rename) — those tokenize to a single word that is not "work".
 *
 * Usage: node surface.mjs <pkgDir> [<pkgDir> ...]
 *        node surface.mjs --selftest
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require_ = createRequire("/home/user/flow-state-dev/package.json");
const { Project, Node } = require_(
  "/home/user/flow-state-dev/node_modules/.pnpm/ts-morph@28.0.0/node_modules/ts-morph/dist/ts-morph.js"
);

/** Split `getRequestWorkPool` -> ["get","request","work","pool"]. */
function tokens(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}
const TOKEN_ARG = process.argv.find((a) => a.startsWith("--token="));
const TOKEN = TOKEN_ARG ? TOKEN_ARG.split("=")[1] : "work";
const carriesWork = (id) => tokens(id).includes(TOKEN);

if (process.argv.includes("--selftest")) {
  const must = ["WorkTrace", "workResults", "getRequestWorkPool", "RequestWorkPool", "workGroupId", "waitForWork", "forEachWork"];
  const mustNot = ["Workstream", "workstreams", "listWorkstreams", "framework", "network", "teamwork", "sideChain", "backgroundTasks", "WorkstreamRef"];
  let ok = true;
  console.log("SELFTEST — must flag:");
  for (const id of must) { const r = carriesWork(id); ok &&= r; console.log(`  ${r ? "FLAG  " : "MISS !!"} ${id.padEnd(22)} ${JSON.stringify(tokens(id))}`); }
  console.log("SELFTEST — must NOT flag:");
  for (const id of mustNot) { const r = carriesWork(id); ok &&= !r; console.log(`  ${r ? "FLAG !!" : "clean "} ${id.padEnd(22)} ${JSON.stringify(tokens(id))}`); }
  console.log(ok ? "\nSELFTEST PASS" : "\nSELFTEST FAIL");
  process.exit(ok ? 0 : 1);
}

const pkgDirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });

for (const dir of pkgDirs) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) { console.log(`!! no package.json in ${dir}`); continue; }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const isPublishable = pkg.private !== true;

  // Map declared export subpaths back to their SOURCE entry points.
  const entries = new Set();
  const guess = (p) =>
    p.replace(/^\.\/dist\//, "./src/").replace(/\.js$/, ".ts").replace(/\.d\.ts$/, ".ts");
  const pc = pkg.publishConfig ?? {};
  for (const [, v] of Object.entries(pc.exports ?? pkg.exports ?? {})) {
    const t = typeof v === "string" ? v : v.types ?? v.default;
    if (t) entries.add(guess(t));
  }
  if (entries.size === 0) entries.add("./src/index.ts");

  console.log(`\n=== ${pkg.name}  v${pkg.version}  publishable=${isPublishable}  access=${pc.access ?? "-"} ===`);
  const flagged = [];
  let exportedCount = 0;

  for (const e of entries) {
    const abs = path.resolve(dir, e);
    if (!fs.existsSync(abs)) { console.log(`   (entry not found on disk: ${e})`); continue; }
    let sf;
    try { sf = project.addSourceFileAtPath(abs); } catch { continue; }

    let decls;
    try { decls = sf.getExportedDeclarations(); } catch (err) { console.log(`   (parse error: ${err.message})`); continue; }

    for (const [name, ds] of decls) {
      exportedCount++;
      if (carriesWork(name)) flagged.push({ kind: "export", name, where: rel(ds[0]) });
      // members of exported interfaces / type literals / classes
      for (const d of ds) {
        for (const m of collectMembers(d)) {
          const mn = typeof m.getName === "function" ? m.getName() : null;
          if (mn && carriesWork(mn)) flagged.push({ kind: "member", name: `${name}.${mn}`, where: rel(m) });
        }
      }
    }
  }
  console.log(`   exported top-level names parsed: ${exportedCount}`);
  if (flagged.length === 0) console.log("   no `work`-token names on the public surface");
  for (const f of flagged) console.log(`   [${f.kind}] ${f.name}\n        ${f.where}`);
}

/**
 * Members of an exported declaration, walking THROUGH intersections and unions.
 * `type X = A & { workResults: ... }` is an IntersectionTypeNode, not a
 * TypeLiteral — walking only TypeLiterals silently misses those members, which
 * is a false-negative class, not a smaller number.
 */
function collectMembers(d, depth = 0) {
  if (depth > 4 || !d) return [];
  if (Node.isInterfaceDeclaration(d) || Node.isClassDeclaration(d)) return d.getMembers();
  if (Node.isTypeAliasDeclaration(d)) return collectFromTypeNode(d.getTypeNode(), depth + 1);
  return [];
}
function collectFromTypeNode(tn, depth) {
  if (depth > 4 || !tn) return [];
  if (Node.isTypeLiteral(tn)) return tn.getMembers();
  if (Node.isIntersectionTypeNode(tn) || Node.isUnionTypeNode(tn)) {
    return tn.getTypeNodes().flatMap((t) => collectFromTypeNode(t, depth + 1));
  }
  return [];
}

function rel(node) {
  const sf = node.getSourceFile();
  return `${path.relative("/home/user/flow-state-dev", sf.getFilePath())}:${sf.getLineAndColumnAtPos(node.getStart()).line}`;
}
