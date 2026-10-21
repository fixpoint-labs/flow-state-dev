#!/usr/bin/env node
/**
 * Fails when a tracked test file under `packages/` is outside every program
 * that package's typecheck script compiles. Vitest strips types, so a
 * src-only `include` or one `exclude` (ui's `test/render`) drifts with
 * nothing going red. A package still waiting is named in `DEFERRED` with
 * the issue that wires it; a covered package left there fails too.
 * Reads configs with the typescript API and never runs `tsc`.
 * Test files come from `git ls-files`, so an untracked test file is invisible to it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { driverPrograms } from "./typecheck-programs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Directory under `packages/` → the issue that removes the entry. */
const DEFERRED = {
  workforce: "FIX-2016: wired after the open PRs that rewrite its tests land",
};

/** Directories and names that mark a test file (the FIX-1343 census's classifier). */
const TEST_DIR = /^(test|tests|__tests__)\//;
const TEST_NAME = /\.(test|spec|test-d)\.(ts|tsx|mts)$/;
const isTestFile = (rel) => TEST_DIR.test(rel) || TEST_NAME.test(rel);

/** Configs a package's `typecheck` script compiles, in order. Throws on a `tsc` form it cannot read. */
export function typecheckPrograms(script, hasConfig) {
  if (!script) return [];
  const out = [];
  for (const segment of script.split("&&")) {
    if (/typecheck\.mjs/.test(segment)) {
      out.push(...driverPrograms(hasConfig));
    } else if (/\btsc\b/.test(segment)) {
      out.push(tscProgram(segment));
    }
  }
  return [...new Set(out)];
}

/** The config one `tsc` segment compiles: `-p X`, `--project X`, or `tsconfig.json`. */
function tscProgram(segment) {
  const unreadable = () => new Error(`unrecognised tsc form in a typecheck script: "${segment.trim()}"`);
  const tokens = segment.trim().split(/\s+/);
  const at = tokens.indexOf("tsc");
  if (at === -1) throw unreadable();
  let config = "tsconfig.json";
  const args = tokens.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-p" || args[i] === "--project") {
      config = args[++i];
      if (config === undefined || config.startsWith("-")) throw unreadable();
    } else if (!args[i].startsWith("--") || /^--(build|project)\b/.test(args[i])) {
      throw unreadable();
    }
  }
  return config;
}

/**
 * Uncovered test files, a deferral whose package is already covered, and a
 * deferral that names no package. Exported so a test can drive it with fixtures.
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
  let programs;
  try {
    programs = typecheckPrograms(manifest.scripts?.typecheck, (name) => existsSync(join(pkgDir, name)));
  } catch (error) {
    throw new Error(`packages/${dir}: ${error.message}`);
  }
  const covered = programs.flatMap((name) => programFiles(pkgDir, name));
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
      console.error(`    packages/${dir}  →  in DEFERRED, but no packages/${dir}/package.json exists`);
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
