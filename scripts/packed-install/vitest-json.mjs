/**
 * Run vitest inside the packed-install consumer project, with the vitest that
 * project installed, and read back its JSON report. Shared by `run.mjs`'s
 * import probe and `suite.mjs`'s case runs, so a change to how vitest is found
 * or how its report is read happens in one place.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Spawn `vitest run <args>` in `dir` with the JSON reporter.
 *
 * @param {string} dir — the consumer project; vitest is resolved from it.
 * @param {string[]} args — files and flags after `run` (`--root` is added).
 * @param {{ env?: NodeJS.ProcessEnv, timeout?: number }} [options]
 * @returns {{ testResults: any[], output: string }} the report's per-file
 *   results (empty when the run produced no report), and the tail of its
 *   output for naming a run that crashed.
 */
export function runVitestJson(dir, args, { env = process.env, timeout = 120_000 } = {}) {
  const report = join(dir, "fsd-vitest-report.json");
  rmSync(report, { force: true });
  const vitest = join(
    dirname(createRequire(join(dir, "package.json")).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const res = spawnSync(
    process.execPath,
    [vitest, "run", ...args, "--root", dir, "--reporter=json", `--outputFile=${report}`],
    { cwd: dir, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, env },
  );
  let testResults = [];
  try {
    testResults = JSON.parse(readFileSync(report, "utf8")).testResults;
  } catch {
    // No report: the run itself failed. The caller reports what never ran.
  }
  return { testResults, output: `${res.stderr ?? ""}${res.stdout ?? ""}`.trim() };
}
