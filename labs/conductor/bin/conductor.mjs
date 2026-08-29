#!/usr/bin/env node
/**
 * Open the conductor board from any directory.
 *
 * Sets `CONDUCTOR_CONFIG` to this lab when the env is unset, then execs
 * `fsdev conductor` without changing cwd. Sit in the product checkout and
 * run this file (or `pnpm conductor` from this package — that script calls
 * this file). `pnpm --dir labs/conductor` still changes cwd; invoke this
 * bin by path when you need to stay in the product.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(labRoot, "fsdev.config.ts");
const fsdev = path.resolve(labRoot, "../../packages/cli/bin/fsdev.ts");
const tsx = path.resolve(labRoot, "../../node_modules/.bin/tsx");

if (!process.env.CONDUCTOR_CONFIG?.trim()) {
  process.env.CONDUCTOR_CONFIG = config;
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

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
