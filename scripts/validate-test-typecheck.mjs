#!/usr/bin/env node
/**
 * Guards that every package's test files are compiled by its typecheck.
 *
 * `pnpm test` runs vitest, which strips types and checks none, so a test file
 * that no `tsc` program opens can drift from the types it uses with nothing
 * going red. That is how 29 packages ended up with tests outside typecheck: a
 * new package copies a neighbour's `include: ["src/**\/*"]`, or one `exclude`
 * line drops a directory (ui's `test/render/**`), and nobody notices.
 *
 * So this checks files, not configs. For each package under `packages/` it
 * reads the programs its `typecheck` script compiles (every `&&` segment: the
 * shared `scripts/typecheck.mjs` runs `tsconfig.json` and then
 * `tsconfig.test.json` when present; `tsc -p X` runs X; a bare `tsc` runs
 * `tsconfig.json`), resolves each program's file list with the repo's
 * `typescript` (so `extends`, `include` and `exclude` behave exactly as in
 * `tsc`), and fails on any tracked test file outside their union.
 *
 * A package may be left out only by name, in `DEFERRED`, with the issue that
 * brings it back. An entry whose package is already fully covered fails too:
 * the package is wired, so the entry has to go.
 *
 * It never runs `tsc`; it only reads configs. Chained into root `typecheck`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Packages whose tests typecheck does not yet fully compile, by workspace
 * directory under `packages/`, each with the issue that wires it.
 *
 * FIX-1343 wires them in a stack of PRs in dependency order; each PR removes
 * its packages from this list. Workforce stays: two open PRs are rewriting its
 * tests, and FIX-2016 wires it after they land.
 */
const LATER_IN_STACK = "FIX-1343: wired by a later PR in its stack";
const DEFERRED = {
  bullmq: LATER_IN_STACK,
  "claude-code": LATER_IN_STACK,
  cli: LATER_IN_STACK,
  client: LATER_IN_STACK,
  codex: LATER_IN_STACK,
  contracts: LATER_IN_STACK,
  cursor: LATER_IN_STACK,
  devtool: LATER_IN_STACK,
  engine: LATER_IN_STACK,
  "harness-manager": LATER_IN_STACK,
  mcp: LATER_IN_STACK,
  memory: LATER_IN_STACK,
  next: LATER_IN_STACK,
  node: LATER_IN_STACK,
  orchestration: LATER_IN_STACK,
  patterns: LATER_IN_STACK,
  react: LATER_IN_STACK,
  scheduled: LATER_IN_STACK,
  "store-postgres": LATER_IN_STACK,
  "store-sqlite": LATER_IN_STACK,
  testing: LATER_IN_STACK,
  "thought-fabric-core": LATER_IN_STACK,
  tools: LATER_IN_STACK,
  ui: LATER_IN_STACK,
  vercel: LATER_IN_STACK,
  "voice-openai": LATER_IN_STACK,
  workspace: LATER_IN_STACK,
  workforce: "FIX-2016: wired after the open PRs that rewrite its tests land",
};

/** Directories and names that mark a test file (the FIX-1343 census's classifier). */
const TEST_DIR = /^(test|tests|__tests__)\//;
const TEST_NAME = /\.(test|spec|test-d)\.(ts|tsx|mts)$/;
const isTestFile = (rel) => TEST_DIR.test(rel) || TEST_NAME.test(rel);

/**
 * The tsconfig files a package's `typecheck` script compiles, in order.
 *
 * @param {string | undefined} script — the package's `scripts.typecheck`.
 * @param {(name: string) => boolean} hasConfig — whether the package has that tsconfig file.
 * @returns {string[]}
 */
export function typecheckPrograms(script, hasConfig) {
  if (!script) return [];
  const out = [];
  for (const segment of script.split("&&")) {
    if (/typecheck\.mjs/.test(segment)) {
      out.push("tsconfig.json");
      if (hasConfig("tsconfig.test.json")) out.push("tsconfig.test.json");
    } else if (/\btsc\b/.test(segment)) {
      out.push(/-p\s+(\S+)/.exec(segment)?.[1] ?? "tsconfig.json");
    }
  }
  return [...new Set(out)];
}

/**
 * Compare each package's test files with what its programs cover.
 *
 * Exported so a test can drive it with fixtures, without depending on the
 * repo's real configs staying still.
 *
 * @param {{ dir: string, tests: string[], covered: string[] }[]} packages —
 *   `tests` are the package's test files and `covered` the files its programs
 *   resolve, both relative to the package directory.
 * @param {Record<string, string>} deferredList — package directory → issue.
 * @returns {{ dir: string, reason: "uncovered" | "stale-deferral" | "unknown-deferral", files?: string[] }[]}
 */
export function findGaps(packages, deferredList) {
  const gaps = [];
  const seen = new Set();
  for (const { dir, tests, covered } of packages) {
    seen.add(dir);
    const inProgram = new Set(covered);
    const uncovered = tests.filter((file) => !inProgram.has(file));
    if (dir in deferredList) {
      if (uncovered.length === 0) gaps.push({ dir, reason: "stale-deferral" });
    } else if (uncovered.length > 0) {
      gaps.push({ dir, reason: "uncovered", files: uncovered });
    }
  }
  for (const dir of Object.keys(deferredList)) {
    if (!seen.has(dir)) gaps.push({ dir, reason: "unknown-deferral" });
  }
  return gaps;
}

/** Files a tsconfig resolves, relative to the package directory. */
function programFiles(pkgDir, configName) {
  const configPath = join(pkgDir, configName);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) {
    throw new Error(`${relative(ROOT, configPath)}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, pkgDir, undefined, configPath);
  return parsed.fileNames.map((file) => relative(pkgDir, file).split(sep).join("/"));
}

/** Read one package's tests and the files its typecheck programs cover. */
function readPackage(dir) {
  const pkgDir = join(ROOT, "packages", dir);
  const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const programs = typecheckPrograms(manifest.scripts?.typecheck, (name) => existsSync(join(pkgDir, name)));
  const covered = programs.filter((name) => existsSync(join(pkgDir, name))).flatMap((name) => programFiles(pkgDir, name));
  const tests = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx", "*.mts"], { cwd: pkgDir, encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !file.endsWith(".d.ts") && isTestFile(file));
  return { dir, tests, covered };
}

function main() {
  const dirs = execFileSync("git", ["ls-files", "packages/*/package.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((path) => path.split("/")[1]);
  const gaps = findGaps(dirs.map(readPackage), DEFERRED);

  if (gaps.length === 0) {
    console.log(
      `✓ test files covered by typecheck in ${dirs.length - Object.keys(DEFERRED).length} package(s); ` +
        `${Object.keys(DEFERRED).length} deferred`,
    );
    process.exit(0);
  }

  console.error(`\n✗ ${gaps.length} package(s) fail the test-typecheck guard:\n`);
  for (const { dir, reason, files } of gaps) {
    if (reason === "uncovered") {
      const shown = files.slice(0, 5).join(", ");
      const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
      console.error(`    packages/${dir}  →  ${files.length} test file(s) outside every typecheck program: ${shown}${more}`);
    } else if (reason === "stale-deferral") {
      console.error(`    packages/${dir}  →  in DEFERRED, but its typecheck already covers every test file`);
    } else {
      console.error(`    ${dir}  →  in DEFERRED, but no packages/${dir}/package.json exists`);
    }
  }
  console.error(
    `\n  A package's typecheck must compile all its test files. Add a tsconfig.test.json` +
      `\n  that extends tsconfig.json and includes the tests (see packages/core/tsconfig.test.json),` +
      `\n  and fix the errors it reports. Only if that must wait, name the package in DEFERRED` +
      `\n  in scripts/validate-test-typecheck.mjs with the issue that wires it.` +
      `\n  Remove a DEFERRED entry once its package is wired.\n`,
  );
  process.exit(1);
}

/** The deferred packages, exported so a test can assert the list's shape. */
export const deferred = DEFERRED;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
