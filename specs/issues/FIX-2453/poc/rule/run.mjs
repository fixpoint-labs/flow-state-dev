#!/usr/bin/env node
/**
 * POC, throwaway: runs the draft rule over the tree the spec scopes and prints
 * the sweep's size by package and by kind. `--control` plants each case and
 * fails unless the rule reports exactly the planted leaks and nothing else.
 *
 *   node specs/issues/FIX-2453/poc/rule/run.mjs            # the sweep's size
 *   node specs/issues/FIX-2453/poc/rule/run.mjs --control  # must print PASS
 *
 * Totality: every tracked .ts/.tsx/.js/.mjs file under the scoped globs is
 * linted, or the run fails naming the ones missed.
 */
import { execSync } from "node:child_process";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import plugin from "./no-tracker-ids.mjs";
import { neverPublish } from "../../../../../scripts/validate-publish-set.mjs";

// The shipped source is every package's src except the held-out ones.
const SHIPPED = ["packages/*/src/**/*.{ts,tsx,mts,js,mjs}"];
const HELD_OUT = neverPublish.map((d) => `packages/${d}/src/**`);
const COPIED = ["packages/ui/registry/**/*.{ts,tsx}", "examples/**/*.{ts,tsx,mts,js,mjs}"];
const ignores = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.d.ts"];

const config = [
  { ignores },
  { files: ["**/*.{ts,tsx,mts,js,mjs}"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { fsd: plugin } },
  { files: SHIPPED, ignores: HELD_OUT, rules: { "fsd/no-tracker-ids": "error" } },
  { files: COPIED, rules: { "fsd/no-tracker-ids": ["error", { comments: "all" }] } },
];
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config, cache: false });

if (process.argv.includes("--control")) {
  const plant = [
    "/** Reads the stream (FIX-101). */ export const a = 1;",
    "// Provenance pointer, kept: FIX-102.",
    "/* A plain block comment, kept: FIX-103. */",
    'throw new Error("which was removed (FIX-104)");',
    "it(`resumes (LAB-105) ${1}`, () => {});",
    "export const ok = 'ENG-106 is an adopter key, not ours';",
    "/** Per BP-030, dual-read. */ export const b = 2;",
  ].join("\n");
  const shipped = (await eslint.lintText(plant, { filePath: "packages/core/src/__plant__.ts" }))[0].messages;
  const copied = (await eslint.lintText(plant, { filePath: "examples/__plant__.ts" }))[0].messages;
  const ids = (ms) => ms.map((m) => /\b[A-Z]+-\d+/.exec(m.message)?.[0]).sort().join(",");
  const want = { shipped: "BP-030,FIX-101,FIX-104,LAB-105", copied: "BP-030,FIX-101,FIX-102,FIX-103,FIX-104,LAB-105" };
  const got = { shipped: ids(shipped), copied: ids(copied) };
  const pass = got.shipped === want.shipped && got.copied === want.copied;
  console.log(JSON.stringify({ want, got }, null, 1));
  console.log(pass ? "PASS: plants reported, pointers in // kept" : "FAIL");
  process.exit(pass ? 0 : 1);
}

const results = (await eslint.lintFiles([...SHIPPED, ...COPIED])).filter(
  (r) => !neverPublish.some((d) => r.filePath.includes(`/packages/${d}/src/`)),
);

// Totality: every tracked file the globs name was linted.
const tracked = execSync("git ls-files ':(glob)packages/*/src/**' ':(glob)packages/ui/registry/**' ':(glob)examples/**'", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f) && !f.endsWith(".d.ts") && !f.includes("/dist/"))
  .filter((f) => !neverPublish.some((d) => f.startsWith(`packages/${d}/src/`)));
const linted = new Set(results.map((r) => r.filePath.slice(process.cwd().length + 1)));
const missed = tracked.filter((f) => !linted.has(f));
if (missed.length) {
  console.error(`FAIL totality: ${missed.length} tracked files not linted, e.g. ${missed.slice(0, 5).join(", ")}`);
  process.exit(1);
}

const by = {};
const kinds = {};
for (const r of results) {
  const rel = r.filePath.slice(process.cwd().length + 1);
  const area = rel.startsWith("examples/") ? "examples" : rel.startsWith("packages/ui/registry") ? "ui/registry" : rel.split("/")[1];
  for (const m of r.messages) {
    if (m.ruleId !== "fsd/no-tracker-ids") continue;
    const kind = /in (a JSDoc block|a string|a template literal|JSX text|a comment in a copied file)/.exec(m.message)[1];
    by[area] = (by[area] ?? 0) + 1;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
}
const total = Object.values(by).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ filesLinted: results.length, tracked: tracked.length, total, kinds, byArea: by }, null, 1));
