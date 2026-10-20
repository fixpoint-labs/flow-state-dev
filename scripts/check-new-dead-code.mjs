#!/usr/bin/env node
/**
 * Fails when the working tree has dead code its base ref doesn't.
 *
 * `fallow audit` only reports findings in the files a change touches. A change
 * that deletes the last call to an export, without editing the file that
 * declares it, leaves that export dead in an untouched file, and the audit
 * passes. This compares the whole tree instead: fallow's dead-code analysis
 * runs on the base ref and saves a baseline, then runs on the head against it,
 * so only findings the head adds anywhere fail.
 *
 * Both runs use the head's `.fallowrc.json`, so a change to the rules is never
 * read as a change to the code. The base is analyzed in this same checkout
 * (`git checkout --detach`, then back) to reuse the installed node_modules; the
 * working tree must be clean for that.
 *
 *   node scripts/check-new-dead-code.mjs <base-ref>
 *
 * Exits 0 when nothing new is dead, 1 when something is (fallow lists it), 2
 * when the comparison couldn't run.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FALLOW = join(ROOT, "node_modules", ".bin", "fallow");

/** The dead-code categories compared; the rest of fallow's checks gate elsewhere. */
const CATEGORIES = [
  "--unused-files",
  "--unused-exports",
  "--unused-types",
  "--unused-deps",
  "--unused-enum-members",
  "--unused-class-members",
];

/** Runs a command in the repo root and returns its exit status and output. */
function run(command, args, inherit = false) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
  return { status: result.status ?? 2, stdout: result.stdout ?? "" };
}

/** Prints a reason and exits 2, the "couldn't compare" status. */
function fail(message) {
  console.error(`check-new-dead-code: ${message}`);
  process.exit(2);
}

const baseRef = process.argv[2];
if (!baseRef) fail("usage: node scripts/check-new-dead-code.mjs <base-ref>");
// Pin a relative ref (`HEAD^1`) before the checkout moves HEAD.
const base = run("git", ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]).stdout.trim();
if (!base) fail(`cannot resolve ${baseRef}`);
if (run("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim()) {
  fail("the working tree has uncommitted changes; commit or stash them first");
}

// Return to the branch by name, so a local run doesn't leave HEAD detached.
const head =
  run("git", ["symbolic-ref", "-q", "--short", "HEAD"]).stdout.trim() ||
  run("git", ["rev-parse", "HEAD"]).stdout.trim();
const dir = mkdtempSync(join(tmpdir(), "fallow-dead-code-"));
const config = join(dir, "fallowrc.json");
const baseline = join(dir, "base.json");
copyFileSync(join(ROOT, ".fallowrc.json"), config);

let problem = null;
if (run("git", ["checkout", "-q", "--detach", base]).status !== 0) {
  problem = `cannot check out ${base}`;
} else {
  // Exit 1 only means the base has findings, which is expected.
  const saved = run(FALLOW, ["dead-code", "-c", config, "--save-baseline", baseline, "--quiet"]);
  if (saved.status > 1 || !statSync(baseline, { throwIfNoEntry: false })?.size) {
    problem = `fallow could not analyze ${base} (exit ${saved.status})`;
  }
}
if (run("git", ["checkout", "-q", head]).status !== 0) problem ??= `cannot return to ${head}`;
if (problem) {
  rmSync(dir, { recursive: true, force: true });
  fail(problem);
}

const compared = run(FALLOW, ["dead-code", "-c", config, "--baseline", baseline, ...CATEGORIES], true);
rmSync(dir, { recursive: true, force: true });
process.exit(compared.status);
