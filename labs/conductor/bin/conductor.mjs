#!/usr/bin/env node
/**
 * Open the conductor board from any directory.
 *
 * Sets `CONDUCTOR_CONFIG` to this lab and `CONDUCTOR_REPO=.` when those
 * are unset, then runs `fsdev conductor` as a child without changing cwd.
 * A stop signal on this process is forwarded to that child. Sit in the
 * product checkout and run this file (or `pnpm conductor` from this
 * package — that script calls this file). `pnpm --dir labs/conductor`
 * still changes cwd; invoke this bin by path when you need to stay in
 * the product. `conductor install` (this bin only) puts `conductor` on
 * PATH under `~/.local/bin`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachConductorChild } from "./child.mjs";
import {
  applyConductorBinDefaults,
  conductorRepoMismatch,
  formatRepoMismatch,
} from "./env.mjs";
import { installConductorOnPath, isConductorBinInstall, pathHasDir } from "./install.mjs";

const self = fileURLToPath(import.meta.url);
if (isConductorBinInstall(process.argv.slice(2))) {
  try {
    const dest = installConductorOnPath(self, process.env);
    process.stdout.write(`installed ${dest}\n`);
    if (!pathHasDir(dest, process.env.PATH)) {
      process.stderr.write(`conductor: add ${path.dirname(dest)} to PATH\n`);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  process.exit(0);
}

const labRoot = path.resolve(path.dirname(self), "..");
const fsdev = path.resolve(labRoot, "../../packages/cli/bin/fsdev.ts");
const tsx = path.resolve(labRoot, "../../node_modules/.bin/tsx");

applyConductorBinDefaults(process.env, labRoot);
const mismatch = conductorRepoMismatch(process.env, process.cwd(), labRoot);
if (mismatch !== undefined) {
  process.stderr.write(formatRepoMismatch(mismatch));
  process.exit(1);
}

if (!existsSync(tsx)) {
  process.stderr.write(
    `conductor: tsx not found at ${tsx}. Run pnpm install from the repo root.\n`,
  );
  process.exit(1);
}
if (!existsSync(fsdev)) {
  process.stderr.write(`conductor: fsdev entry not found at ${fsdev}.\n`);
  process.exit(1);
}

const child = spawn(tsx, [fsdev, "conductor", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});
attachConductorChild(child);
