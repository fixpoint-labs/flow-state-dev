#!/usr/bin/env node
/**
 * FIX-1343 test-typecheck census — re-derives the spec's counted facts from the tree.
 *
 * For every workspace package under `packages/`, it answers two questions:
 *   1. Does the program `pnpm typecheck` runs for this package open its test files today?
 *      (read off the package's `typecheck` script and the tsconfig it points at)
 *   2. If it did, how many errors would it report — in the test files, and where?
 *
 * Question 2 is measured by running `tsc --noEmit` once per package on a throwaway config
 * that extends the package's own typecheck config (same compilerOptions, same project
 * references, so dependencies resolve to their built `dist` as in CI) with `composite` off,
 * `rootDir` at the repo root (tests import packages they do not reference; with noEmit, rootDir only gates containment), and the package's `include` plus every test directory. Errors are attributed
 * to the package's test files, its `src`, or elsewhere.
 * Prerequisite: `pnpm packages:build` (CI's typecheck runs after `^build` for the same reason).
 *
 * Totality: every tracked .ts/.tsx/.mts file in each package is classified as covered by the
 * typecheck program today, a test file, or "other" (configs, scripts, stories). A test file the
 * classifier cannot place fails the run, so a test directory nobody listed cannot hide.
 *
 * Negative control: `--plant` writes a test file with one deliberate type error into the first
 * package named with `--only`, runs the census on it, and fails unless exactly one more
 * test-file error is reported. The planted file is always removed.
 *
 * Usage (from the repo root, after `pnpm install`):
 *   node specs/issues/FIX-1343/poc/test-typecheck-census/census.mjs [--only a,b] [--json] [--plant]
 * Memory: tsc runs one package at a time. Set NODE_OPTIONS=--max-old-space-size=N to cap it.
 * Retained spec evidence; not part of any package, test glob, or build.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const ROOT = process.cwd();
const only = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? args[i + 1].split(",") : null;
})();
const asJson = args.includes("--json");
const plant = args.includes("--plant");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
if (!existsSync(TSC)) {
  console.error("census: no node_modules/.bin/tsc — run `pnpm install` first");
  process.exit(2);
}

const TEST_DIR = /^(test|tests|__tests__)\//;
const TEST_NAME = /\.(test|spec|test-d)\.(ts|tsx|mts)$/;
const isTestFile = (rel) => TEST_DIR.test(rel) || TEST_NAME.test(rel);

/** Parse JSON with comments and trailing commas (tsconfig is JSONC). */
function readJsonc(path) {
  const src = readFileSync(path, "utf8");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      const start = i;
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++;
      out += src.slice(start, i + 1);
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Minimal glob → RegExp for tsconfig include patterns (`**`, `*`, literal paths). */
function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += "(" + glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")";
      i = end;
    } else re += c.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  // A bare directory include (`src`) or `dir/**/*` matches everything beneath it.
  return new RegExp("^" + re + "(/.*)?$");
}

/** The tsconfig the package's `typecheck` script runs, or null when it runs none. */
function typecheckConfig(pkgDir, script) {
  if (!script) return null;
  const m = /tsc\b[^&]*?-p\s+(\S+)/.exec(script);
  if (m && !/typecheck\.mjs/.test(script.split("&&")[0])) return m[1];
  // scripts/typecheck.mjs and a bare `tsc --noEmit` both run tsconfig.json.
  return "tsconfig.json";
}

const packages = execFileSync("git", ["ls-files", "packages/*/package.json"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .map((p) => p.split("/")[1])
  .filter((name) => !only || only.includes(name));

function census(name) {
  const dir = join(ROOT, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const script = pkg.scripts?.typecheck ?? null;
  const cfgName = typecheckConfig(dir, script);
  const cfg = cfgName && existsSync(join(dir, cfgName)) ? readJsonc(join(dir, cfgName)) : null;
  const include = cfg?.include ?? ["**/*"];
  const exclude = cfg?.exclude ?? [];
  const inRe = include.map(globToRe);
  const exRe = exclude.map(globToRe);
  const covered = (rel) => inRe.some((r) => r.test(rel)) && !exRe.some((r) => r.test(rel));

  const files = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx", "*.mts"], { cwd: dir, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.endsWith(".d.ts"));
  const tests = files.filter(isTestFile);
  const testsCovered = tests.filter(covered);
  const testsUncovered = tests.filter((f) => !covered(f));
  // Totality: a test-named file outside any test dir that is not under src/ is unplaced.
  const unplaced = tests.filter((f) => !TEST_DIR.test(f) && !f.startsWith("src/"));

  const testIncludes = [...new Set(tests.map((f) => (TEST_DIR.test(f) ? f.split("/")[0] + "/**/*" : f)))];
  const probe = join(dir, "tsconfig.fix1343-census.json");
  // The shape under test: the package's own typecheck config, widened to its tests. It keeps
  // the package's compilerOptions and project references (deps resolve to their built `dist`,
  // exactly as CI's typecheck sees them after `^build`), and drops only what emitting needs.
  writeFileSync(
    probe,
    JSON.stringify({
      extends: `./${cfgName ?? "tsconfig.json"}`,
      compilerOptions: { composite: false, incremental: false, rootDir: "../..", noEmit: true, declaration: false, declarationMap: false, sourceMap: false },
      include: [...(cfg?.include ?? ["src/**/*"]), ...testIncludes],
      exclude: [...exclude, "node_modules", "dist"],
    })
  );
  let out;
  const t0 = Date.now();
  try {
    const r = spawnSync(TSC, ["-p", probe, "--pretty", "false"], { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status === null) throw new Error(`tsc killed by ${r.signal} on ${name} (OOM? lower parallelism or raise --max-old-space-size)`);
    out = r.stdout + r.stderr;
  } finally {
    rmSync(probe, { force: true });
  }
  const secs = Math.round((Date.now() - t0) / 1000);

  const errs = [];
  for (const line of out.split("\n")) {
    const m = /^(.+?)\(\d+,\d+\): error (TS\d+):/.exec(line);
    if (m) errs.push({ file: relative(dir, join(dir, m[1])).split(sep).join("/"), code: m[2] });
    else if (/^error (TS\d+):/.test(line)) errs.push({ file: "<config>", code: /TS\d+/.exec(line)[0] });
  }
  const where = (e) => (e.file.startsWith("..") ? "elsewhere" : isTestFile(e.file) ? "test" : e.file === "<config>" ? "config" : "src");
  const by = (pred) => errs.filter(pred);
  const testErrs = by((e) => where(e) === "test");
  const codes = {};
  for (const e of testErrs) codes[e.code] = (codes[e.code] ?? 0) + 1;
  return {
    name,
    typecheckConfig: cfgName,
    testFiles: tests.length,
    testsCoveredToday: testsCovered.length,
    testsUncoveredToday: testsUncovered.length,
    unplaced,
    errors: {
      test: testErrs.length,
      testFiles: new Set(testErrs.map((e) => e.file)).size,
      testD: testErrs.filter((e) => /\.test-d\.ts$/.test(e.file)).length,
      src: by((e) => where(e) === "src").length,
      elsewhere: by((e) => where(e) === "elsewhere").length,
      config: by((e) => where(e) === "config").length,
    },
    topCodes: Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 3),
    secs,
  };
}

if (plant) {
  if (!only || only.length !== 1) {
    console.error("census: --plant needs exactly one package in --only");
    process.exit(2);
  }
  const before = census(only[0]).errors.test;
  const planted = join(ROOT, "packages", only[0], "test", "__fix1343_census_plant__.test.ts");
  writeFileSync(planted, "// planted by the FIX-1343 census negative control\nexport const planted: number = \"not a number\";\n");
  let after;
  try {
    after = census(only[0]).errors.test;
  } finally {
    rmSync(planted, { force: true });
  }
  const ok = after === before + 1;
  console.log(`negative control on ${only[0]}: test errors ${before} → ${after} with one planted error · ${ok ? "PASS (the census sees it)" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

const rows = [];
for (const name of packages) {
  const row = census(name);
  rows.push(row);
  if (!asJson) process.stderr.write(`  ${name}: ${row.errors.test} test errors (${row.secs}s)\n`);
}
const unplaced = rows.flatMap((r) => r.unplaced.map((f) => `${r.name}/${f}`));

if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  console.log("| package | test files | opened by typecheck today | errors in tests (files) | of which .test-d | src | dep src | top codes |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const r of rows) {
    const today = r.testFiles === 0 ? "n/a" : r.testsUncoveredToday === 0 ? "all" : r.testsCoveredToday === 0 ? "none" : `${r.testsCoveredToday}/${r.testFiles}`;
    console.log(
      `| ${r.name} | ${r.testFiles} | ${today} | ${r.errors.test} (${r.errors.testFiles}) | ${r.errors.testD} | ${r.errors.src} | ${r.errors.elsewhere} | ${r.topCodes.map(([c, n]) => `${c}×${n}`).join(" ")} |`
    );
  }
  const withTests = rows.filter((r) => r.testFiles > 0);
  const blind = withTests.filter((r) => r.testsCoveredToday === 0);
  const clean = blind.filter((r) => r.errors.test === 0);
  console.log(
    `\n${rows.length} packages · ${withTests.length} with tests · ${blind.length} whose typecheck opens none of them · ` +
      `${clean.length} of those already clean · ${rows.reduce((n, r) => n + r.errors.test, 0)} test-file errors in total`
  );
}
if (unplaced.length) {
  console.error(`census: ${unplaced.length} test-named file(s) outside test dirs and src/ — classify them:\n  ${unplaced.join("\n  ")}`);
  process.exit(1);
}
