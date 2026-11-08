#!/usr/bin/env node
/**
 * Re-derives the spec's counted facts: how many `ctx` casts each package's
 * `src` carries, by spelling. Throwaway spec evidence, not a repository check.
 *
 *   node specs/issues/FIX-2457/poc/cast-census/census.mjs           # the census
 *   node specs/issues/FIX-2457/poc/cast-census/census.mjs --plant   # negative control
 *
 * Totality: every `.ts`/`.tsx` file under `packages/<pkg>/src` is read, and the
 * per-package sums must equal one independent whole-tree count, or it exits 1.
 * Control: `--plant` writes one cast into a temp file under a package's `src`,
 * and the census must report exactly one more `as never` cast, or it exits 1.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const SPELLINGS = {
  "ctx as never": /\bctx as never\b/g,
  "ctx as BlockContext": /\bctx as BlockContext\b/g,
  "ctx as unknown as BlockContext": /\bctx as unknown as BlockContext\b/g,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function census() {
  const byPkg = {};
  const pkgs = path.join(root, "packages");
  for (const pkg of fs.readdirSync(pkgs)) {
    const src = path.join(pkgs, pkg, "src");
    if (!fs.existsSync(src)) continue;
    for (const file of walk(src)) {
      const text = fs.readFileSync(file, "utf8");
      for (const [name, re] of Object.entries(SPELLINGS)) {
        const n = (text.match(re) ?? []).length;
        if (n === 0) continue;
        byPkg[pkg] ??= {};
        byPkg[pkg][name] = (byPkg[pkg][name] ?? 0) + n;
      }
    }
  }
  return byPkg;
}

function totalOf(byPkg, name) {
  return Object.values(byPkg).reduce((s, c) => s + (c[name] ?? 0), 0);
}

/** Independent count: git grep over the tracked tree, a different walker. Exit 1 is no match, so 0; 2 and above is an error. */
function gitCount(pattern) {
  const r = spawnSync("git", ["grep", "-ohE", pattern, "--", "packages/*/src/**"], { cwd: root, encoding: "utf8" });
  if (r.status === 1) return 0;
  if (r.status !== 0) throw new Error(`git grep failed (exit ${r.status ?? r.signal}): ${r.error?.message ?? r.stderr}`);
  return r.stdout.split("\n").filter(Boolean).length;
}

const byPkg = census();
const total = totalOf(byPkg, "ctx as never");

if (process.argv.includes("--plant")) {
  const planted = path.join(root, "packages/core/src/__census-plant.ts");
  fs.writeFileSync(planted, "declare const ctx: unknown; export const x = ctx as never;\n");
  try {
    const after = totalOf(census(), "ctx as never");
    if (after !== total + 1) { console.error(`CONTROL FAILED: planted one cast, census moved ${total} -> ${after}`); process.exit(1); }
    console.log(`control ok: planted one cast, census moved ${total} -> ${after}`);
  } finally { fs.rmSync(planted); }
  process.exit(0);
}

for (const [pkg, c] of Object.entries(byPkg).sort()) console.log(pkg.padEnd(20), JSON.stringify(c));
for (const name of Object.keys(SPELLINGS)) console.log(`total ${name}: ${totalOf(byPkg, name)}`);

const independent = gitCount("\\bctx as never\\b");
if (independent !== total) { console.error(`TOTALITY FAILED: walker ${total}, git grep ${independent}`); process.exit(1); }
console.log(`totality ok: walker and git grep agree on ${total}`);
