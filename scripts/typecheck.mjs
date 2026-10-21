/**
 * Run `tsc --noEmit` for the package in the current working directory:
 * `tsconfig.json`, then `tsconfig.test.json` when the package has one.
 *
 * Every package's `typecheck` script routes through here, so this file is the
 * single place that decides whether a typecheck happened. It must never report
 * success without having run `tsc`: a green typecheck is evidence other work
 * rests on (BP-003), and a check that passes when TypeScript is absent is a
 * false green in exactly the checkouts where it is easiest to trust — a fresh
 * clone, a new worktree, a container that skipped install.
 *
 * This script once carried a regex import-scan fallback, added when the registry
 * was unreachable and dependencies could not be installed. It checked no types
 * yet printed "static typecheck passed", so it was removed. Don't reintroduce
 * it: a missing `tsc` is a broken checkout, and the only honest thing to do is
 * say so and fail.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { driverPrograms } from "./typecheck-programs.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const packageDir = process.cwd();
const tsconfigPath = path.join(packageDir, "tsconfig.json");
const srcDir = path.join(packageDir, "src");
const tscPath = path.join(rootDir, "node_modules", ".bin", "tsc");

if (!fs.existsSync(tsconfigPath)) {
  console.error(`typecheck failed: missing tsconfig at ${tsconfigPath}`);
  process.exit(1);
}

if (!fs.existsSync(srcDir)) {
  console.error(`typecheck failed: missing src directory at ${srcDir}`);
  process.exit(1);
}

if (!fs.existsSync(tscPath)) {
  console.error(
    `typecheck failed: TypeScript is not installed (no ${path.relative(rootDir, tscPath)}). ` +
      `NO types were checked. Run \`pnpm install\` at the repo root, then re-run.`
  );
  process.exit(1);
}

const configs = driverPrograms((name) => fs.existsSync(path.join(packageDir, name)));

// Run every config even after one fails, so one's errors never hide the other's.
let failedStatus = 0;
for (const config of configs) {
  const tscRun = spawnSync(tscPath, ["-p", config, "--noEmit"], {
    cwd: packageDir,
    stdio: "inherit"
  });

  if (tscRun.error) {
    console.error(`typecheck failed: could not run ${tscPath}: ${tscRun.error.message}`);
    process.exit(1);
  }

  if (tscRun.status !== 0 && failedStatus === 0) failedStatus = tscRun.status ?? 1;
}

process.exit(failedStatus);
