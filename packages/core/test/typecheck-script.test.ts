import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptSource = fs.readFileSync(path.join(repoRoot, "scripts/typecheck.mjs"), "utf8");
const programsSource = fs.readFileSync(path.join(repoRoot, "scripts/typecheck-programs.mjs"), "utf8");

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The script resolves `tsc` relative to its own location, so the only way to
 * exercise a checkout without TypeScript is to stand one up: a synthetic root
 * holding a copy of the script, the program list it imports, and one package
 * for it to check.
 */
function makeRoot(): { root: string; packageDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-typecheck-"));
  tempRoots.push(root);

  const packageDir = path.join(root, "packages", "demo");
  fs.mkdirSync(path.join(packageDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });

  fs.writeFileSync(path.join(root, "scripts", "typecheck.mjs"), scriptSource);
  fs.writeFileSync(path.join(root, "scripts", "typecheck-programs.mjs"), programsSource);
  fs.writeFileSync(path.join(packageDir, "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(packageDir, "src", "index.ts"), "export const answer = 42;\n");

  return { root, packageDir };
}

/**
 * The fake compiler is a POSIX shell script, so the two cases that need one are
 * gated to POSIX. That is not a coverage gap on Windows: the script spawns the
 * extensionless `node_modules/.bin/tsc` directly, which Windows cannot execute
 * either (pnpm writes `tsc.cmd` there for it), so a shim that ran on Windows
 * would be testing behaviour production does not have. The two assertions that
 * carry this file — a missing toolchain fails, and never says "passed" — need
 * no shim and run everywhere.
 */
const onPosix = process.platform !== "win32";

/** Install a fake `tsc` that exits with `status`, standing in for the real compiler. */
function installFakeTsc(root: string, status: number): void {
  const binDir = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const tscPath = path.join(binDir, "tsc");
  fs.writeFileSync(tscPath, `#!/bin/sh\nexit ${status}\n`);
  fs.chmodSync(tscPath, 0o755);
}

/**
 * Install a fake `tsc` that appends its `-p` config to `calls.log`, exits with
 * `status` for `tsconfig.test.json` and with `buildStatus` for `tsconfig.json`.
 */
function installRecordingTsc(root: string, status: number, buildStatus = 0): string {
  const binDir = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(root, "calls.log");
  const tscPath = path.join(binDir, "tsc");
  fs.writeFileSync(
    tscPath,
    `#!/bin/sh\necho "$2" >> "${log}"\n[ "$2" = "tsconfig.test.json" ] && exit ${status}\nexit ${buildStatus}\n`
  );
  fs.chmodSync(tscPath, 0o755);
  return log;
}

function run(root: string, packageDir: string) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "typecheck.mjs")], {
    cwd: packageDir,
    encoding: "utf8",
  });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * This script is the one place that decides whether a typecheck happened, so a
 * success it reports is evidence every other check is read through. It shipped
 * for months with a fallback that printed "static typecheck passed" when `tsc`
 * was absent — a green that could not go red, in exactly the checkouts (fresh
 * clone, new worktree, container that skipped install) that trust it most.
 * These tests exist so that failure mode cannot come back silently.
 */
describe("typecheck script — never reports success without running tsc", () => {
  it("fails when TypeScript is not installed", () => {
    const { root, packageDir } = makeRoot();

    expect(run(root, packageDir).status).not.toBe(0);
  });

  it("does not call a missing toolchain a pass, and names the fix", () => {
    const { root, packageDir } = makeRoot();
    const { output } = run(root, packageDir);

    expect(output).not.toMatch(/passed/i);
    expect(output).toMatch(/pnpm install/);
  });

  it.skipIf(!onPosix)("propagates a failing tsc rather than swallowing it", () => {
    const { root, packageDir } = makeRoot();
    installFakeTsc(root, 2);

    expect(run(root, packageDir).status).toBe(2);
  });

  it.skipIf(!onPosix)("succeeds only when tsc actually ran and was clean", () => {
    const { root, packageDir } = makeRoot();
    installFakeTsc(root, 0);

    expect(run(root, packageDir).status).toBe(0);
  });
});

/**
 * Test files are compiled only by the second program. If the script stopped
 * running it, the guard would still count those tests as covered, so both the
 * call and its failure are pinned here.
 */
describe("typecheck script — runs tsconfig.test.json after tsconfig.json", () => {
  it.skipIf(!onPosix)("runs both programs, build config first, when the package has a test config", () => {
    const { root, packageDir } = makeRoot();
    fs.writeFileSync(path.join(packageDir, "tsconfig.test.json"), "{}");
    const log = installRecordingTsc(root, 0);

    expect(run(root, packageDir).status).toBe(0);
    expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["tsconfig.json", "tsconfig.test.json"]);
  });

  it.skipIf(!onPosix)("fails when only the test-config program fails", () => {
    const { root, packageDir } = makeRoot();
    fs.writeFileSync(path.join(packageDir, "tsconfig.test.json"), "{}");
    installRecordingTsc(root, 3);

    expect(run(root, packageDir).status).toBe(3);
  });

  it.skipIf(!onPosix)("runs the test config even when the build config fails, so neither hides the other", () => {
    const { root, packageDir } = makeRoot();
    fs.writeFileSync(path.join(packageDir, "tsconfig.test.json"), "{}");
    const log = installRecordingTsc(root, 3, 2);

    expect(run(root, packageDir).status).toBe(2);
    expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["tsconfig.json", "tsconfig.test.json"]);
  });

  it.skipIf(!onPosix)("runs only tsconfig.json when the package has no test config", () => {
    const { root, packageDir } = makeRoot();
    const log = installRecordingTsc(root, 3);

    expect(run(root, packageDir).status).toBe(0);
    expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["tsconfig.json"]);
  });
});
